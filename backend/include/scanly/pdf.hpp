#pragma once

#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "scanly/types.hpp"

namespace scanly {

class PdfError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

struct PdfPageInput {
  /** Encoded (JPEG/PNG) bytes of the processed page image. */
  std::string imageBytes;
  /** OCR result for the invisible text layer; nullopt = image-only page. */
  std::optional<OcrResult> ocr;
};

struct PdfDocumentInput {
  std::string title;
  std::vector<PdfPageInput> pages;
};

/**
 * Build a searchable PDF entirely in memory.
 * Each page renders its scanned image with an invisible, selectable OCR text
 * layer positioned from word bounding boxes (PDF text render mode 3).
 * Throws PdfError when a page image cannot be decoded or writing fails.
 */
std::string buildSearchablePdf(const PdfDocumentInput& input);

}  // namespace scanly
