#include <gtest/gtest.h>

#include <opencv2/imgproc.hpp>

#include "scanly/detection.hpp"

namespace scanly {
namespace {

cv::Mat syntheticDocumentImage(int width = 800, int height = 1000) {
  // Dark background with a light, slightly rotated rectangle "page" and text-like lines.
  cv::Mat image(height, width, CV_8UC3, cv::Scalar(30, 30, 30));
  std::vector<cv::Point> page = {
      {120, 150}, {660, 130}, {680, 860}, {100, 880},
  };
  cv::fillConvexPoly(image, page, cv::Scalar(245, 245, 245));
  for (int i = 0; i < 8; ++i) {
    cv::line(image, {180, 220 + i * 70}, {600, 215 + i * 70}, cv::Scalar(20, 20, 20), 6);
  }
  return image;
}

TEST(OrderQuadPoints, OrdersShuffledCorners) {
  const std::array<cv::Point2f, 4> shuffled = {
      cv::Point2f(100, 800),  // BL
      cv::Point2f(100, 100),  // TL
      cv::Point2f(700, 800),  // BR
      cv::Point2f(700, 100),  // TR
  };
  const auto ordered = orderQuadPoints(shuffled);
  EXPECT_FLOAT_EQ(ordered[0].x, 100);   // TL
  EXPECT_FLOAT_EQ(ordered[0].y, 100);
  EXPECT_FLOAT_EQ(ordered[1].x, 700);   // TR
  EXPECT_FLOAT_EQ(ordered[1].y, 100);
  EXPECT_FLOAT_EQ(ordered[2].x, 700);   // BR
  EXPECT_FLOAT_EQ(ordered[2].y, 800);
  EXPECT_FLOAT_EQ(ordered[3].x, 100);   // BL
  EXPECT_FLOAT_EQ(ordered[3].y, 800);
}

TEST(DetectDocument, FindsSyntheticPage) {
  const cv::Mat image = syntheticDocumentImage();
  const Detection result = detectDocument(image);
  ASSERT_TRUE(result.found) << "expected the synthetic page to be detected";
  EXPECT_GT(result.confidence, 0.35);

  // Corners must be ordered TL, TR, BR, BL and near the drawn quad.
  EXPECT_LT(result.corners[0].x, result.corners[1].x);  // TL left of TR
  EXPECT_LT(result.corners[0].y, result.corners[3].y);  // TL above BL
  EXPECT_NEAR(result.corners[0].x, 110, 40);
  EXPECT_NEAR(result.corners[0].y, 140, 40);
  EXPECT_NEAR(result.corners[2].x, 680, 40);
  EXPECT_NEAR(result.corners[2].y, 860, 40);
}

TEST(DetectDocument, ReturnsNotFoundOnNoise) {
  cv::Mat noise(600, 600, CV_8UC3);
  cv::RNG rng(42);
  rng.fill(noise, cv::RNG::UNIFORM, 0, 255);
  const Detection result = detectDocument(noise);
  EXPECT_FALSE(result.found);
  EXPECT_DOUBLE_EQ(result.confidence, 0.0);
}

TEST(DetectDocument, RejectsTinyImages) {
  cv::Mat tiny(10, 10, CV_8UC3, cv::Scalar(255, 255, 255));
  EXPECT_FALSE(detectDocument(tiny).found);
  EXPECT_FALSE(detectDocument(cv::Mat()).found);
}

}  // namespace
}  // namespace scanly
