#include "scanly/image_process.hpp"

#include <algorithm>
#include <opencv2/geometry.hpp>
#include <opencv2/imgproc.hpp>

#include "scanly/detection.hpp"

namespace scanly {

Filter parseFilter(const std::string& id) {
  if (id == "original") return Filter::Original;
  if (id == "grayscale") return Filter::Grayscale;
  if (id == "black-white") return Filter::BlackWhite;
  if (id == "auto") return Filter::Auto;
  if (id == "contrast") return Filter::Contrast;
  if (id == "sharpen") return Filter::Sharpen;
  throw std::invalid_argument("Unknown filter: " + id);
}

void validateOptions(const ProcessOptions& options) {
  if (options.rotation != 0 && options.rotation != 90 && options.rotation != 180 && options.rotation != 270) {
    throw std::invalid_argument("rotation must be 0, 90, 180 or 270");
  }
  if (options.brightness < 0.5 || options.brightness > 2.0) {
    throw std::invalid_argument("brightness must be within [0.5, 2.0]");
  }
  if (options.contrast < 0.5 || options.contrast > 2.0) {
    throw std::invalid_argument("contrast must be within [0.5, 2.0]");
  }
  if (options.maxWidth && *options.maxWidth < 64) {
    throw std::invalid_argument("maxWidth must be at least 64 pixels");
  }
}

namespace {

double edgeLength(const cv::Point2f& a, const cv::Point2f& b) {
  return std::hypot(static_cast<double>(a.x - b.x), static_cast<double>(a.y - b.y));
}

cv::Mat warpToQuad(const cv::Mat& image, const std::array<std::array<double, 2>, 4>& normalized) {
  const std::array<cv::Point2f, 4> pixel{{
      cv::Point2f(static_cast<float>(normalized[0][0] * image.cols), static_cast<float>(normalized[0][1] * image.rows)),
      cv::Point2f(static_cast<float>(normalized[1][0] * image.cols), static_cast<float>(normalized[1][1] * image.rows)),
      cv::Point2f(static_cast<float>(normalized[2][0] * image.cols), static_cast<float>(normalized[2][1] * image.rows)),
      cv::Point2f(static_cast<float>(normalized[3][0] * image.cols), static_cast<float>(normalized[3][1] * image.rows)),
  }};
  const auto quad = orderQuadPoints(pixel);

  const double topWidth = edgeLength(quad[0], quad[1]);
  const double bottomWidth = edgeLength(quad[3], quad[2]);
  const double leftHeight = edgeLength(quad[0], quad[3]);
  const double rightHeight = edgeLength(quad[1], quad[2]);
  int outWidth = static_cast<int>(std::round(std::max(topWidth, bottomWidth)));
  int outHeight = static_cast<int>(std::round(std::max(leftHeight, rightHeight)));
  outWidth = std::max(outWidth, 16);
  outHeight = std::max(outHeight, 16);

  // Never upscale beyond ~1.6x the larger source dimension.
  const int maxAllowed = static_cast<int>(std::max(image.cols, image.rows) * 1.6);
  if (std::max(outWidth, outHeight) > maxAllowed) {
    const double k = static_cast<double>(maxAllowed) / std::max(outWidth, outHeight);
    outWidth = std::max(16, static_cast<int>(outWidth * k));
    outHeight = std::max(16, static_cast<int>(outHeight * k));
  }

  const std::array<cv::Point2f, 4> destination{{
      cv::Point2f(0.f, 0.f),
      cv::Point2f(static_cast<float>(outWidth - 1), 0.f),
      cv::Point2f(static_cast<float>(outWidth - 1), static_cast<float>(outHeight - 1)),
      cv::Point2f(0.f, static_cast<float>(outHeight - 1)),
  }};

  const cv::Mat transform = cv::getPerspectiveTransform(quad.data(), destination.data());
  cv::Mat warped;
  cv::warpPerspective(image, warped, transform, cv::Size(outWidth, outHeight), cv::INTER_LINEAR,
                      cv::BORDER_REPLICATE);
  return warped;
}

cv::Mat applyRotation(const cv::Mat& image, int rotation) {
  cv::Mat out;
  switch (rotation) {
    case 90: cv::rotate(image, out, cv::ROTATE_90_CLOCKWISE); break;
    case 180: cv::rotate(image, out, cv::ROTATE_180); break;
    case 270: cv::rotate(image, out, cv::ROTATE_90_COUNTERCLOCKWISE); break;
    default: out = image; break;
  }
  return out;
}

cv::Mat toGrayBgr(const cv::Mat& gray) {
  cv::Mat bgr;
  cv::cvtColor(gray, bgr, cv::COLOR_GRAY2BGR);
  return bgr;
}

cv::Mat applyBlackWhite(const cv::Mat& image) {
  cv::Mat gray;
  cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
  cv::Mat blurred;
  cv::GaussianBlur(gray, blurred, cv::Size(3, 3), 0);
  cv::Mat binary;
  const int blockSize = std::max(11, (std::min(blurred.cols, blurred.rows) / 20) | 1);
  cv::adaptiveThreshold(blurred, binary, 255, cv::ADAPTIVE_THRESH_GAUSSIAN_C, cv::THRESH_BINARY, blockSize, 12);
  return toGrayBgr(binary);
}

// Document mode: shadow flattening via background division + CLAHE contrast on luminance.
cv::Mat applyAuto(const cv::Mat& image) {
  cv::Mat lab;
  cv::cvtColor(image, lab, cv::COLOR_BGR2Lab);
  std::vector<cv::Mat> channels;
  cv::split(lab, channels);

  // Estimate uneven lighting with a heavily blurred luminance; divide it out.
  cv::Mat background;
  const int kernel = std::max(15, (std::min(channels[0].cols, channels[0].rows) / 8) | 1);
  cv::blur(channels[0], background, cv::Size(kernel, kernel));

  cv::Mat flattened;
  cv::Mat backgroundF;
  background.convertTo(backgroundF, CV_32F);
  cv::Mat luminanceF;
  channels[0].convertTo(luminanceF, CV_32F);
  cv::Mat normalized;
  cv::divide(luminanceF * 128.0, backgroundF + 12.0, normalized);
  cv::threshold(normalized, normalized, 255, 255, cv::THRESH_TRUNC);
  normalized.convertTo(channels[0], CV_8U);

  cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(2.0, cv::Size(8, 8));
  clahe->apply(channels[0], channels[0]);

  cv::merge(channels, lab);
  cv::Mat result;
  cv::cvtColor(lab, result, cv::COLOR_Lab2BGR);
  return result;
}

cv::Mat applyFilter(const cv::Mat& image, Filter filter) {
  switch (filter) {
    case Filter::Original:
      return image;
    case Filter::Grayscale: {
      cv::Mat gray;
      cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
      return toGrayBgr(gray);
    }
    case Filter::BlackWhite:
      return applyBlackWhite(image);
    case Filter::Auto:
      return applyAuto(image);
    case Filter::Contrast: {
      cv::Mat lab;
      cv::cvtColor(image, lab, cv::COLOR_BGR2Lab);
      std::vector<cv::Mat> channels;
      cv::split(lab, channels);
      cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(3.0, cv::Size(4, 4));
      clahe->apply(channels[0], channels[0]);
      cv::merge(channels, lab);
      cv::Mat result;
      cv::cvtColor(lab, result, cv::COLOR_Lab2BGR);
      return result;
    }
    case Filter::Sharpen: {
      static const cv::Mat kernel =
          (cv::Mat_<float>(3, 3) << 0, -1, 0, -1, 5, -1, 0, -1, 0);
      cv::Mat result;
      cv::filter2D(image, result, -1, kernel);
      return result;
    }
  }
  return image;
}

}  // namespace

cv::Mat processImage(const cv::Mat& image, const ProcessOptions& options) {
  if (image.empty()) throw std::invalid_argument("Empty image");
  validateOptions(options);

  cv::Mat stage = image;
  if (options.corners) stage = warpToQuad(stage, *options.corners);
  if (options.rotation != 0) stage = applyRotation(stage, options.rotation);
  stage = applyFilter(stage, options.filter);

  // Contrast scales around mid-gray; brightness shifts the result:
  //   out = (in - 127.5) * contrast + 127.5 + (brightness - 1) * 127.5
  //       = in * contrast + (brightness - contrast) * 127.5
  const double alpha = options.contrast;
  const double beta = 127.5 * (options.brightness - options.contrast);
  if (std::abs(alpha - 1.0) > 1e-6 || std::abs(beta) > 1e-6) {
    cv::Mat adjusted;
    // convertTo clamps at 0/255; convertScaleAbs would wrap negatives.
    stage.convertTo(adjusted, -1, alpha, beta);
    stage = adjusted;
  }

  if (options.maxWidth && stage.cols > *options.maxWidth) {
    const double k = static_cast<double>(*options.maxWidth) / stage.cols;
    cv::Mat resized;
    cv::resize(stage, resized, cv::Size(*options.maxWidth, std::max(1, static_cast<int>(stage.rows * k))), 0, 0,
               cv::INTER_AREA);
    stage = resized;
  }
  return stage;
}

}  // namespace scanly
