#include "scanly/detection.hpp"

#include <algorithm>
#include <cmath>
#include <opencv2/geometry.hpp>
#include <opencv2/imgproc.hpp>

namespace scanly {
namespace {

constexpr int kDetectMaxDim = 900;
constexpr double kMinAreaRatio = 0.12;
constexpr double kMinScore = 0.35;

double clamp01(double value) { return std::clamp(value, 0.0, 1.0); }

double pointDistance(const cv::Point2f& a, const cv::Point2f& b) {
  return std::hypot(static_cast<double>(a.x - b.x), static_cast<double>(a.y - b.y));
}

double quadArea(const std::array<cv::Point2f, 4>& quad) {
  // Shoelace formula.
  double area = 0;
  for (int i = 0; i < 4; ++i) {
    const auto& a = quad[i];
    const auto& b = quad[(i + 1) % 4];
    area += static_cast<double>(a.x) * b.y - static_cast<double>(b.x) * a.y;
  }
  return std::abs(area) / 2.0;
}

// Score a quad: coverage, rectangularity, aspect plausibility and centrality.
double scoreQuad(const std::array<cv::Point2f, 4>& quad, const cv::Size& size, double contourArea) {
  const double imageArea = static_cast<double>(size.width) * size.height;
  const double area = quadArea(quad);
  if (imageArea <= 0 || area <= 0) return 0;

  const double coverage = clamp01(area / (imageArea * 0.95));

  // OpenCV 5's RotatedRect has no .area(); compute width*height from its size.
  const cv::RotatedRect minRect = cv::minAreaRect(std::vector<cv::Point2f>(quad.begin(), quad.end()));
  const double minRectArea = static_cast<double>(minRect.size.width) * minRect.size.height;
  const double rectangularity = minRectArea > 0 ? clamp01(area / minRectArea) : 0;

  // Border-touching quads are usually not the document of interest.
  const double topEdge = pointDistance(quad[0], quad[1]);
  const double bottomEdge = pointDistance(quad[3], quad[2]);
  const double leftEdge = pointDistance(quad[0], quad[3]);
  const double rightEdge = pointDistance(quad[1], quad[2]);
  const double width = (topEdge + bottomEdge) / 2.0;
  const double height = (leftEdge + rightEdge) / 2.0;
  if (width < 1 || height < 1) return 0;
  const double aspect = width > height ? width / height : height / width;
  const double aspectScore = aspect <= 2.5 ? 1.0 : clamp01(1.0 - (aspect - 2.5) / 2.0);

  cv::Point2f center(0, 0);
  for (const auto& p : quad) center += p;
  center *= 0.25f;
  const double cx = center.x / size.width;
  const double cy = center.y / size.height;
  const double centrality = clamp01(1.0 - (std::hypot(cx - 0.5, cy - 0.5) / 0.75));

  // Edge-strength support: fraction of quad perimeter sitting on strong edges.
  const double contourRatio = clamp01(contourArea > 0 ? area / contourArea : 0.0);

  const double score = 0.30 * coverage + 0.30 * rectangularity + 0.15 * aspectScore +
                       0.10 * centrality + 0.15 * clamp01(contourRatio / 40.0);
  return clamp01(score);
}

}  // namespace

std::array<cv::Point2f, 4> orderQuadPoints(const std::array<cv::Point2f, 4>& points) {
  // Sum/diff heuristic: min sum = TL, max sum = BR, min diff = TR, max diff = BL.
  double sums[4];
  double diffs[4];
  for (int i = 0; i < 4; ++i) {
    sums[i] = points[i].x + points[i].y;
    diffs[i] = points[i].y - points[i].x;
  }
  auto indexOfType = [&](bool wantMax, bool useSum) {
    int best = 0;
    double bestValue = useSum ? sums[0] : diffs[0];
    for (int i = 1; i < 4; ++i) {
      const double value = useSum ? sums[i] : diffs[i];
      if (wantMax ? value > bestValue : value < bestValue) {
        best = i;
        bestValue = value;
      }
    }
    return best;
  };
  std::array<cv::Point2f, 4> ordered{};
  ordered[0] = points[indexOfType(false, true)];   // TL: min(x+y)
  ordered[2] = points[indexOfType(true, true)];    // BR: max(x+y)
  ordered[1] = points[indexOfType(false, false)];  // TR: min(y-x)
  ordered[3] = points[indexOfType(true, false)];   // BL: max(y-x)
  return ordered;
}

Detection detectDocument(const cv::Mat& image) {
  Detection result;
  if (image.empty() || image.cols < 32 || image.rows < 32) return result;

  const double scale =
      static_cast<double>(kDetectMaxDim) / std::max(image.cols, image.rows);
  const bool downscale = scale < 1.0;
  cv::Mat small;
  if (downscale) {
    cv::resize(image, small, cv::Size(), scale, scale, cv::INTER_AREA);
  } else {
    small = image;
  }

  cv::Mat gray;
  cv::cvtColor(small, gray, cv::COLOR_BGR2GRAY);
  cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);

  cv::Mat edges;
  cv::Canny(gray, edges, 50, 150);
  cv::dilate(edges, edges, cv::Mat(), cv::Point(-1, -1), 1);

  std::vector<std::vector<cv::Point>> contours;
  cv::findContours(edges, contours, cv::RETR_LIST, cv::CHAIN_APPROX_SIMPLE);

  const double smallArea = static_cast<double>(small.cols) * small.rows;
  struct Candidate {
    std::array<cv::Point2f, 4> quad;
    double score;
  };
  std::vector<Candidate> candidates;

  for (const auto& contour : contours) {
    const double area = cv::contourArea(contour);
    if (area < kMinAreaRatio * smallArea) continue;

    std::vector<cv::Point> approx;
    const double perimeter = cv::arcLength(contour, true);
    cv::approxPolyDP(contour, approx, 0.02 * perimeter, true);
    if (approx.size() != 4 || !cv::isContourConvex(approx)) continue;

    std::array<cv::Point2f, 4> raw{};
    for (int i = 0; i < 4; ++i) raw[i] = cv::Point2f(static_cast<float>(approx[i].x), static_cast<float>(approx[i].y));
    auto quad = orderQuadPoints(raw);
    const double score = scoreQuad(quad, small.size(), area);
    if (score >= kMinScore) candidates.push_back({quad, score});
  }

  if (candidates.empty()) return result;
  const auto best = std::max_element(candidates.begin(), candidates.end(),
                                     [](const Candidate& a, const Candidate& b) { return a.score < b.score; });

  const double invScale = downscale ? 1.0 / scale : 1.0;
  for (int i = 0; i < 4; ++i) {
    result.corners[i] = cv::Point2f(static_cast<float>(best->quad[i].x * invScale),
                                    static_cast<float>(best->quad[i].y * invScale));
  }
  result.found = true;
  result.confidence = best->score;
  return result;
}

}  // namespace scanly
