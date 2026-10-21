#include <gtest/gtest.h>

#include <opencv2/imgproc.hpp>

#include "scanly/image_process.hpp"

namespace scanly {
namespace {

TEST(ParseFilter, AcceptsKnownFilters) {
  EXPECT_EQ(parseFilter("original"), Filter::Original);
  EXPECT_EQ(parseFilter("grayscale"), Filter::Grayscale);
  EXPECT_EQ(parseFilter("black-white"), Filter::BlackWhite);
  EXPECT_EQ(parseFilter("auto"), Filter::Auto);
  EXPECT_EQ(parseFilter("contrast"), Filter::Contrast);
  EXPECT_EQ(parseFilter("sharpen"), Filter::Sharpen);
}

TEST(ParseFilter, RejectsUnknown) {
  EXPECT_THROW(parseFilter("sepia"), std::invalid_argument);
  EXPECT_THROW(parseFilter(""), std::invalid_argument);
}

TEST(ValidateOptions, RejectsOutOfRangeValues) {
  ProcessOptions options;
  options.rotation = 45;
  EXPECT_THROW(validateOptions(options), std::invalid_argument);

  options = ProcessOptions{};
  options.brightness = 4.0;
  EXPECT_THROW(validateOptions(options), std::invalid_argument);

  options = ProcessOptions{};
  options.contrast = 0.1;
  EXPECT_THROW(validateOptions(options), std::invalid_argument);

  options = ProcessOptions{};
  options.maxWidth = 8;
  EXPECT_THROW(validateOptions(options), std::invalid_argument);
}

TEST(ProcessImage, WarpsPerspectiveQuadToUpright) {
  // Skewed white page with dark stripes; warp to the quad should rectify it.
  cv::Mat image(900, 700, CV_8UC3, cv::Scalar(20, 20, 20));
  const std::vector<cv::Point> quad = {{90, 120}, {610, 80}, {640, 800}, {60, 760}};
  cv::fillConvexPoly(image, quad, cv::Scalar(240, 240, 240));

  ProcessOptions options;
  options.corners = std::array<std::array<double, 2>, 4>{{
      {{90.0 / 700, 120.0 / 900}},
      {{610.0 / 700, 80.0 / 900}},
      {{640.0 / 700, 800.0 / 900}},
      {{60.0 / 700, 760.0 / 900}},
  }};
  options.filter = Filter::Original;

  const cv::Mat out = processImage(image, options);
  ASSERT_FALSE(out.empty());
  // Output should be roughly the quad's span: ~550x680 (bounded by 1.6x rule).
  EXPECT_NEAR(out.cols, 550, 60);
  EXPECT_NEAR(out.rows, 680, 60);

  // After warping, the page should dominate: most pixels are light.
  cv::Mat gray;
  cv::cvtColor(out, gray, cv::COLOR_BGR2GRAY);
  const double lightRatio = static_cast<double>(cv::countNonZero(gray > 180)) / (out.cols * out.rows);
  EXPECT_GT(lightRatio, 0.85);
}

TEST(ProcessImage, RotationSwapsDimensions) {
  cv::Mat image(400, 800, CV_8UC3, cv::Scalar(120, 100, 80));
  ProcessOptions options;
  options.rotation = 90;
  const cv::Mat out = processImage(image, options);
  EXPECT_EQ(out.cols, 400);
  EXPECT_EQ(out.rows, 800);
}

TEST(ProcessImage, GrayscaleKeepsThreeChannelsAndNeutralColor) {
  cv::Mat image(120, 160, CV_8UC3);
  image.setTo(cv::Scalar(60, 120, 200));
  ProcessOptions options;
  options.filter = Filter::Grayscale;
  const cv::Mat out = processImage(image, options);
  ASSERT_EQ(out.channels(), 3);
  // Pixel is the same across channels.
  const cv::Vec3b px = out.at<cv::Vec3b>(60, 80);
  EXPECT_EQ(px[0], px[1]);
  EXPECT_EQ(px[1], px[2]);
}

TEST(ProcessImage, BlackWhiteProducesBinaryOutput) {
  cv::Mat image(240, 320, CV_8UC3, cv::Scalar(180, 180, 180));
  cv::rectangle(image, {60, 60}, {260, 180}, cv::Scalar(40, 40, 40), cv::FILLED);
  ProcessOptions options;
  options.filter = Filter::BlackWhite;
  const cv::Mat out = processImage(image, options);
  cv::Mat gray;
  cv::cvtColor(out, gray, cv::COLOR_BGR2GRAY);
  for (int y = 0; y < gray.rows; y += 13) {
    for (int x = 0; x < gray.cols; x += 17) {
      const uchar v = gray.at<uchar>(y, x);
      EXPECT_TRUE(v == 0 || v == 255) << "non-binary pixel " << int(v);
    }
  }
}

TEST(ProcessImage, MaxWidthDownscalesAndKeepsAspect) {
  cv::Mat image(1000, 2000, CV_8UC3, cv::Scalar(90, 90, 90));
  ProcessOptions options;
  options.maxWidth = 1000;
  const cv::Mat out = processImage(image, options);
  EXPECT_EQ(out.cols, 1000);
  EXPECT_EQ(out.rows, 500);
}

TEST(ProcessImage, BrightnessIncreasesMean) {
  cv::Mat image(100, 100, CV_8UC3, cv::Scalar(100, 100, 100));
  ProcessOptions options;
  options.brightness = 1.5;
  const cv::Mat out = processImage(image, options);
  const double before = cv::mean(image)[0];
  const double after = cv::mean(out)[0];
  EXPECT_GT(after, before);
}

TEST(ProcessImage, RejectsEmptyImage) {
  ProcessOptions options;
  EXPECT_THROW(processImage(cv::Mat(), options), std::invalid_argument);
}

}  // namespace
}  // namespace scanly
