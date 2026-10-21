#pragma once

#include <array>
#include <opencv2/core.hpp>
#include <optional>
#include <stdexcept>
#include <string>

namespace scanly {

enum class Filter { Original, Grayscale, BlackWhite, Auto, Contrast, Sharpen };

struct ProcessOptions {
  /** Normalized [0..1] corners (TL, TR, BR, BL) for perspective correction. */
  std::optional<std::array<std::array<double, 2>, 4>> corners;
  Filter filter = Filter::Original;
  int rotation = 0;  // 0 | 90 | 180 | 270
  double brightness = 1.0;  // [0.5, 2.0]
  double contrast = 1.0;    // [0.5, 2.0]
  std::optional<int> maxWidth;  // optional downscale cap in pixels
};

/** Parse a filter id ("auto", "grayscale", ...). Throws std::invalid_argument on unknown ids. */
Filter parseFilter(const std::string& id);

/** Validate rotation/brightness/contrast ranges. Throws std::invalid_argument when out of range. */
void validateOptions(const ProcessOptions& options);

/**
 * Perspective correction + enhancement pipeline.
 * Order: warp (if corners) → rotation → filter → brightness/contrast → optional downscale.
 * Throws std::invalid_argument on invalid input.
 */
cv::Mat processImage(const cv::Mat& image, const ProcessOptions& options);

}  // namespace scanly
