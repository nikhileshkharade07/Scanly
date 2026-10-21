#pragma once

#include <array>
#include <opencv2/core.hpp>
#include <utility>

namespace scanly {

struct Detection {
  bool found = false;
  double confidence = 0;
  /** Ordered TL, TR, BR, BL in source-image pixel coordinates. */
  std::array<cv::Point2f, 4> corners{};
};

/** Order four quad points as top-left, top-right, bottom-right, bottom-left. */
std::array<cv::Point2f, 4> orderQuadPoints(const std::array<cv::Point2f, 4>& points);

/**
 * Detect a document (paper-like quadrilateral) in a BGR image.
 * Returns found=false with confidence 0 when no candidate is reliable.
 */
Detection detectDocument(const cv::Mat& image);

}  // namespace scanly
