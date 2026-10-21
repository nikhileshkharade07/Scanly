#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>
#include <opencv2/imgproc.hpp>

#include "scanly/ocr.hpp"

namespace scanly {
namespace {

std::string upperCopy(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
  return value;
}

/** Render clean synthetic text that Tesseract reliably recognizes. */
cv::Mat renderTextImage() {
  const std::string line1 = "INVOICE";
  const std::string line2 = "TOTAL DUE 1200";
  const int width = 1400;
  const int height = 400;
  cv::Mat image(height, width, CV_8UC3, cv::Scalar(255, 255, 255));
  cv::putText(image, line1, {60, 150}, cv::FONT_HERSHEY_SIMPLEX, 3.0, cv::Scalar(0, 0, 0), 8,
              cv::LINE_AA);
  cv::putText(image, line2, {60, 320}, cv::FONT_HERSHEY_SIMPLEX, 2.4, cv::Scalar(0, 0, 0), 7,
              cv::LINE_AA);
  return image;
}

TEST(OcrLanguages, ReportsInstalledLanguages) {
  const auto languages = availableOcrLanguages();
  ASSERT_FALSE(languages.empty()) << "tesseract data not found; check TESSDATA_PREFIX";
  EXPECT_TRUE(std::is_sorted(languages.begin(), languages.end()));
  EXPECT_NE(std::find(languages.begin(), languages.end(), "eng"), languages.end());
}

TEST(RecognizeText, ReadsSyntheticText) {
  const cv::Mat image = renderTextImage();
  const OcrResult result = recognizeText(image, "eng");

  EXPECT_EQ(result.width, image.cols);
  EXPECT_EQ(result.height, image.rows);
  EXPECT_GT(result.confidence, 0.0);
  EXPECT_LE(result.confidence, 100.0);

  const std::string text = upperCopy(result.text);
  EXPECT_NE(text.find("INVOICE"), std::string::npos) << "raw text: " << result.text;

  // Structure: blocks → lines → words with pixel boxes inside the image.
  ASSERT_FALSE(result.blocks.empty());
  int wordCount = 0;
  for (const auto& block : result.blocks) {
    EXPECT_FALSE(block.id.empty());
    for (const auto& line : block.lines) {
      for (const auto& word : line.words) {
        ++wordCount;
        EXPECT_FALSE(word.text.empty());
        EXPECT_GE(word.bbox.x, 0);
        EXPECT_GE(word.bbox.y, 0);
        EXPECT_LE(word.bbox.x + word.bbox.width, image.cols + 2);
        EXPECT_LE(word.bbox.y + word.bbox.height, image.rows + 2);
        EXPECT_GE(word.confidence, 0);
        EXPECT_LE(word.confidence, 100);
      }
    }
  }
  EXPECT_GE(wordCount, 2);
}

TEST(RecognizeText, BlankImageYieldsEmptyResult) {
  const cv::Mat blank(300, 300, CV_8UC3, cv::Scalar(255, 255, 255));
  const OcrResult result = recognizeText(blank, "eng");
  EXPECT_TRUE(result.blocks.empty());
  EXPECT_DOUBLE_EQ(result.confidence, 0.0);
}

TEST(RecognizeText, RejectsEmptyImage) {
  EXPECT_THROW(recognizeText(cv::Mat(), "eng"), OcrError);
}

TEST(RecognizeText, RejectsMissingLanguage) {
  const cv::Mat image = renderTextImage();
  EXPECT_THROW(recognizeText(image, "zz-nonexistent"), OcrError);
}

}  // namespace
}  // namespace scanly
