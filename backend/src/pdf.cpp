#include "scanly/pdf.hpp"

#include <algorithm>
#include <cstdint>
#include <podofo/podofo.h>

namespace scanly {
namespace {

// Scanned pages carry no DPI metadata, so assume a typical 150 DPI capture
// and map pixels to PDF points (72/150). OCR boxes use the same scale, so
// the invisible text layer stays aligned with the rendered image.
constexpr double kAssumedDpi = 150.0;
constexpr double kPointsPerInch = 72.0;
constexpr double kScale = kPointsPerInch / kAssumedDpi;

/**
 * Transliterate UTF-8 to the byte range representable in the base-14
 * Helvetica (Latin-1) layer. Unrepresentable sequences become '?'.
 */
std::string toLatin1(const std::string& utf8) {
  std::string out;
  out.reserve(utf8.size());
  std::size_t i = 0;
  while (i < utf8.size()) {
    const auto c = static_cast<unsigned char>(utf8[i]);
    if (c < 0x80) {
      out.push_back(static_cast<char>(c));
      ++i;
      continue;
    }
    const int len = (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 16 ? 4 : 0;
    if (len == 0) {
      out.push_back('?');
      ++i;
      continue;
    }
    uint32_t cp = static_cast<uint32_t>(c & (0x7F >> len));
    bool ok = true;
    for (int k = 1; k < len; ++k) {
      if (i + static_cast<std::size_t>(k) >= utf8.size() ||
          (utf8[i + static_cast<std::size_t>(k)] & 0xC0) != 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (static_cast<unsigned char>(utf8[i + static_cast<std::size_t>(k)]) & 0x3F);
    }
    if (!ok) {
      out.push_back('?');
      ++i;
      continue;
    }
    i += static_cast<std::size_t>(len);
    out.push_back(cp < 0x100 ? static_cast<char>(cp) : '?');
  }
  return out;
}

}  // namespace

std::string buildSearchablePdf(const PdfDocumentInput& input) {
  if (input.pages.empty()) throw PdfError("PDF requires at least one page");

  try {
    PoDoFo::PdfMemDocument doc;
    PoDoFo::PdfFont& font =
        doc.GetFonts().GetStandard14Font(PoDoFo::PdfStandard14FontType::Helvetica);
    doc.GetMetadata().SetTitle(PoDoFo::PdfString(toLatin1(input.title)));

    PoDoFo::PdfPainter painter;

    for (const auto& page : input.pages) {
      if (page.imageBytes.empty()) throw PdfError("Page image is empty");

      auto image = doc.CreateImage();
      const auto info = image->LoadFromBuffer(
          PoDoFo::bufferview(page.imageBytes.data(), page.imageBytes.size()));
      if (info.Width == 0 || info.Height == 0) throw PdfError("Page image has no pixels");
      const double imgW = info.Width;
      const double imgH = info.Height;

      const double pageW = imgW * kScale;
      const double pageH = imgH * kScale;
      auto& pdfPage = doc.GetPages().CreatePage(PoDoFo::Rect(0, 0, pageW, pageH));

      painter.SetCanvas(pdfPage);
      painter.DrawImage(*image, 0, 0, kScale, kScale);

      if (page.ocr) {
        const auto& ocr = *page.ocr;
        const double srcW = ocr.width > 0 ? static_cast<double>(ocr.width) : imgW;
        const double srcH = ocr.height > 0 ? static_cast<double>(ocr.height) : imgH;
        const double sx = (srcW > 0 ? pageW / srcW : kScale);
        const double sy = (srcH > 0 ? pageH / srcH : kScale);

        painter.TextState.SetRenderingMode(PoDoFo::PdfTextRenderingMode::Invisible);
        for (const auto& block : ocr.blocks) {
          for (const auto& line : block.lines) {
            for (const auto& word : line.words) {
              if (word.text.empty() || word.bbox.width <= 0 || word.bbox.height <= 0) continue;
              const double x = word.bbox.x * sx;
              const double boxH = word.bbox.height * sy;
              // Place the baseline at the box bottom so glyphs cover the box;
              // scale font size so cap height approximates the box height.
              const double baseline = pageH - (word.bbox.y * sy) - boxH;
              const double fontSize = std::max(boxH * 1.3, 4.0);
              painter.TextState.SetFont(font, fontSize);
              painter.DrawText(toLatin1(word.text), x, baseline);
            }
          }
        }
        painter.TextState.SetRenderingMode(PoDoFo::PdfTextRenderingMode::Fill);
      }

      painter.FinishDrawing();
    }

    std::string out;
    PoDoFo::ContainerStreamDevice<std::string> device(out);
    doc.Save(device);
    return out;
  } catch (const PdfError&) {
    throw;
  } catch (const std::exception& e) {
    throw PdfError(std::string("PDF generation failed: ") + e.what());
  }
}

}  // namespace scanly
