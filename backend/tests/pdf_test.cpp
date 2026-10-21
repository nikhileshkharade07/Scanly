#include <gtest/gtest.h>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include "scanly/pdf.hpp"

namespace scanly {
namespace {

std::string makeJpeg(int width = 600, int height = 800) {
  cv::Mat image(height, width, CV_8UC3, cv::Scalar(250, 250, 250));
  cv::rectangle(image, {40, 40}, {width - 40, height - 40}, cv::Scalar(30, 30, 30), 3);
  cv::putText(image, "SCANLY", {90, 200}, cv::FONT_HERSHEY_SIMPLEX, 2.0, cv::Scalar(0, 0, 0), 5,
              cv::LINE_AA);
  std::vector<uchar> buffer;
  cv::imencode(".jpg", image, buffer, {cv::IMWRITE_JPEG_QUALITY, 85});
  return std::string(reinterpret_cast<const char*>(buffer.data()), buffer.size());
}

OcrResult sampleOcr(int width, int height) {
  OcrResult result;
  result.text = "SCANLY Test Page";
  result.confidence = 88.5;
  result.width = width;
  result.height = height;

  OcrWord word;
  word.id = "b0l0w0";
  word.text = "SCANLY";
  word.confidence = 92.0;
  word.bbox = BBox{90, 150, 300, 60};

  OcrLine line;
  line.id = "b0l0";
  line.text = "SCANLY";
  line.confidence = 91.0;
  line.bbox = BBox{90, 150, 300, 60};
  line.words.push_back(word);

  OcrBlock block;
  block.id = "b0";
  block.type = "text";
  block.text = "SCANLY";
  block.confidence = 91.0;
  block.bbox = BBox{90, 150, 300, 60};
  block.lines.push_back(line);
  result.blocks.push_back(block);
  return result;
}

TEST(BuildSearchablePdf, ProducesValidPdfBytes) {
  PdfDocumentInput input;
  input.title = "Test Document";
  PdfPageInput page;
  page.imageBytes = makeJpeg();
  page.ocr = sampleOcr(600, 800);
  input.pages.push_back(std::move(page));

  const std::string pdf = buildSearchablePdf(input);
  ASSERT_GE(pdf.size(), 100u);
  EXPECT_EQ(pdf.rfind("%PDF-", 0), 0u) << "PDF must start with %PDF signature";
  EXPECT_NE(pdf.find("Test Document"), std::string::npos);
  // EOF marker at (or near) the end.
  const auto eof = pdf.rfind("%%EOF");
  ASSERT_NE(eof, std::string::npos);
  EXPECT_LE(pdf.size() - eof, 32u);
}

TEST(BuildSearchablePdf, MultiPageDocument) {
  PdfDocumentInput input;
  input.title = "Two Pages";
  for (int i = 0; i < 2; ++i) {
    PdfPageInput page;
    page.imageBytes = makeJpeg(500, 700);
    input.pages.push_back(std::move(page));
  }
  const std::string pdf = buildSearchablePdf(input);
  EXPECT_EQ(pdf.rfind("%PDF-", 0), 0u);
}

TEST(BuildSearchablePdf, ImageOnlyPageIsValid) {
  PdfDocumentInput input;
  input.title = "Image Only";
  PdfPageInput page;
  page.imageBytes = makeJpeg();  // no OCR
  input.pages.push_back(std::move(page));
  const std::string pdf = buildSearchablePdf(input);
  EXPECT_EQ(pdf.rfind("%PDF-", 0), 0u);
}

TEST(BuildSearchablePdf, HandlesLatin1AndReplacesUnknownGlyphs) {
  PdfDocumentInput input;
  input.title = "Caf\xC3\xA9 \xE2\x82\xAC";  // UTF-8: Café €
  PdfPageInput page;
  page.imageBytes = makeJpeg();
  page.ocr = sampleOcr(600, 800);
  input.pages.push_back(std::move(page));
  EXPECT_NO_THROW(buildSearchablePdf(input));
}

TEST(BuildSearchablePdf, RejectsEmptyDocument) {
  PdfDocumentInput input;
  input.title = "Nothing";
  EXPECT_THROW(buildSearchablePdf(input), PdfError);
}

TEST(BuildSearchablePdf, RejectsEmptyPageBytes) {
  PdfDocumentInput input;
  input.title = "Bad Page";
  PdfPageInput page;
  page.imageBytes = "";
  input.pages.push_back(std::move(page));
  EXPECT_THROW(buildSearchablePdf(input), PdfError);
}

TEST(BuildSearchablePdf, RejectsUndecodableImage) {
  PdfDocumentInput input;
  input.title = "Garbage";
  PdfPageInput page;
  page.imageBytes = "this is not an image at all";
  input.pages.push_back(std::move(page));
  EXPECT_THROW(buildSearchablePdf(input), PdfError);
}

}  // namespace
}  // namespace scanly
