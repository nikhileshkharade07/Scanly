#pragma once

#include <opencv2/core.hpp>
#include <stdexcept>
#include <string>
#include <vector>

#include "scanly/types.hpp"

namespace scanly {

class OcrError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/** Languages whose data packs are installed for the bundled Tesseract build. */
std::vector<std::string> availableOcrLanguages();

/**
 * Run Tesseract OCR on a BGR image.
 * Produces full text plus block/line/word structure with pixel bounding boxes and
 * confidences (0-100). Throws OcrError when the engine or language data is unavailable,
 * or when recognition itself fails.
 */
OcrResult recognizeText(const cv::Mat& image, const std::string& language);

}  // namespace scanly
