#include <gtest/gtest.h>

#include <crow.h>
#include <nlohmann/json.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include <map>
#include <string>
#include <vector>

#include "scanly/server.hpp"

namespace scanly {
namespace {

std::string makeJpeg(int width = 400, int height = 500) {
  cv::Mat image(height, width, CV_8UC3, cv::Scalar(250, 250, 250));
  cv::rectangle(image, {30, 30}, {width - 30, height - 30}, cv::Scalar(20, 20, 20), 3);
  std::vector<uchar> buffer;
  cv::imencode(".jpg", image, buffer, {cv::IMWRITE_JPEG_QUALITY, 80});
  return std::string(reinterpret_cast<const char*>(buffer.data()), buffer.size());
}

std::string buildMultipart(
    const std::vector<std::pair<std::string, std::string>>& fields,
    const std::map<std::string, std::string>& filenames = {},
    const std::string& boundary = "scanly-test-boundary") {
  std::string body;
  for (const auto& [name, value] : fields) {
    body += "--" + boundary + "\r\n";
    body += "Content-Disposition: form-data; name=\"" + name + "\"";
    auto it = filenames.find(name);
    if (it != filenames.end()) {
      body += "; filename=\"" + it->second + "\"";
      body += "\r\nContent-Type: image/jpeg";
    }
    body += "\r\n\r\n";
    body += value;
    body += "\r\n";
  }
  body += "--" + boundary + "--\r\n";
  return body;
}

crow::request makeRequest(crow::HTTPMethod method, const std::string& url,
                          const std::string& body = "",
                          const std::string& contentType = "",
                          const std::string& origin = "") {
  crow::request req;
  req.method = method;
  req.url = url;
  req.body = body;
  if (!contentType.empty()) req.add_header("Content-Type", contentType);
  if (!origin.empty()) req.add_header("Origin", origin);
  req.add_header("Content-Length", std::to_string(body.size()));
  return req;
}

crow::response dispatch(crow::SimpleApp& app, crow::request req) {
  crow::response res;
  app.handle_full(req, res);
  return res;
}

nlohmann::json asJson(const crow::response& res) {
  return nlohmann::json::parse(res.body, nullptr, false);
}

ServerConfig testConfig() {
  ServerConfig config;
  config.allowedOrigins = {"http://localhost:3000"};
  config.maxBodyBytes = 20ull * 1024 * 1024;
  return config;
}

TEST(Api, HealthReportsEnginesAndLanguages) {
  auto app = buildApp(testConfig());
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::GET, "/api/health"));
  ASSERT_EQ(res.code, 200);
  const auto body = asJson(res);
  EXPECT_EQ(body.at("status"), "ok");
  EXPECT_TRUE(body.at("engine").contains("opencv"));
  EXPECT_TRUE(body.at("engine").contains("tesseract"));
  EXPECT_FALSE(body.at("languages").empty());
}

TEST(Api, UnknownPathReturnsJson404) {
  auto app = buildApp(testConfig());
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::GET, "/api/does-not-exist"));
  EXPECT_EQ(res.code, 404);
  EXPECT_EQ(asJson(res).at("error").at("code"), "not_found");
}

TEST(Api, RejectsForeignOrigin) {
  auto app = buildApp(testConfig());
  const auto res =
      dispatch(*app, makeRequest(crow::HTTPMethod::GET, "/api/health", "", "", "http://evil.example"));
  EXPECT_EQ(res.code, 403);
  EXPECT_EQ(asJson(res).at("error").at("code"), "forbidden_origin");
}

TEST(Api, AllowsConfiguredOriginWithCorsHeaders) {
  auto app = buildApp(testConfig());
  auto res = dispatch(*app,
                            makeRequest(crow::HTTPMethod::GET, "/api/health", "", "", "http://localhost:3000"));
  EXPECT_EQ(res.code, 200);
  EXPECT_EQ(res.get_header_value("Access-Control-Allow-Origin"), "http://localhost:3000");
}

TEST(Api, PreflightReturns204WithCors) {
  auto app = buildApp(testConfig());
  auto req = makeRequest(crow::HTTPMethod::OPTIONS, "/api/ocr", "", "", "http://localhost:3000");
  auto res = dispatch(*app, std::move(req));
  EXPECT_EQ(res.code, 204);
  EXPECT_EQ(res.get_header_value("Access-Control-Allow-Origin"), "http://localhost:3000");
}

TEST(Api, NonMultipartPostIs415) {
  auto app = buildApp(testConfig());
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", "raw", "text/plain"));
  EXPECT_EQ(res.code, 415);
  EXPECT_EQ(asJson(res).at("error").at("code"), "unsupported_media_type");
}

TEST(Api, OversizedBodyIs413) {
  ServerConfig config = testConfig();
  config.maxBodyBytes = 64;
  auto app = buildApp(config);
  const auto body = buildMultipart({{"image", makeJpeg()}}, {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 413);
  EXPECT_EQ(asJson(res).at("error").at("code"), "too_large");
}

TEST(Api, MissingImageFieldIs400) {
  auto app = buildApp(testConfig());
  const auto body = buildMultipart({{"lang", "eng"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 400);
  EXPECT_EQ(asJson(res).at("error").at("code"), "bad_request");
}

TEST(Api, DetectReturnsNormalizedCorners) {
  auto app = buildApp(testConfig());
  const auto body = buildMultipart({{"image", makeJpeg(400, 500)}}, {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/vision/detect", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  ASSERT_EQ(res.code, 200);
  const auto data = asJson(res);
  EXPECT_TRUE(data.contains("found"));
  EXPECT_EQ(data.at("imageWidth"), 400);
  EXPECT_EQ(data.at("imageHeight"), 500);
  if (data.at("found").get<bool>()) {
    ASSERT_EQ(data.at("corners").size(), 4u);
    for (const auto& corner : data.at("corners")) {
      ASSERT_EQ(corner.size(), 2u);
      EXPECT_GE(corner.at(0).get<double>(), 0.0);
      EXPECT_LE(corner.at(0).get<double>(), 1.0);
      EXPECT_GE(corner.at(1).get<double>(), 0.0);
      EXPECT_LE(corner.at(1).get<double>(), 1.0);
    }
  }
}

TEST(Api, ProcessReturnsJpeg) {
  auto app = buildApp(testConfig());
  const std::string options = R"({"filter":"grayscale","rotation":0})";
  const auto body =
      buildMultipart({{"image", makeJpeg()}, {"options", options}}, {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/image/process", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  ASSERT_EQ(res.code, 200);
  EXPECT_EQ(res.get_header_value("Content-Type"), "image/jpeg");
  ASSERT_GE(res.body.size(), 4u);
  EXPECT_EQ(static_cast<unsigned char>(res.body[0]), 0xFF);
  EXPECT_EQ(static_cast<unsigned char>(res.body[1]), 0xD8);
}

TEST(Api, ProcessRejectsUnknownFilter) {
  auto app = buildApp(testConfig());
  const std::string options = R"({"filter":"sepia"})";
  const auto body =
      buildMultipart({{"image", makeJpeg()}, {"options", options}}, {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/image/process", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 400);
  EXPECT_EQ(asJson(res).at("error").at("code"), "bad_request");
}

TEST(Api, ProcessRejectsOutOfBoundsCorners) {
  auto app = buildApp(testConfig());
  const std::string options =
      R"({"filter":"original","corners":[[0.1,0.1],[5.0,0.1],[5.0,5.0],[0.1,5.0]]})";
  const auto body =
      buildMultipart({{"image", makeJpeg()}, {"options", options}}, {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/image/process", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 400);
}

TEST(Api, OcrReturnsStructuredResult) {
  auto app = buildApp(testConfig());
  const auto body = buildMultipart({{"image", makeJpeg()}, {"lang", "eng"}},
                                   {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  ASSERT_EQ(res.code, 200);
  const auto data = asJson(res);
  EXPECT_TRUE(data.contains("text"));
  EXPECT_TRUE(data.contains("blocks"));
  EXPECT_TRUE(data.contains("width"));
  EXPECT_TRUE(data.contains("height"));
}

TEST(Api, OcrRejectsUnknownLanguage) {
  auto app = buildApp(testConfig());
  const auto body = buildMultipart({{"image", makeJpeg()}, {"lang", "zz-nope"}},
                                   {{"image", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 400);
  EXPECT_EQ(asJson(res).at("error").at("code"), "unsupported_language");
}

TEST(Api, SearchablePdfReturnsPdfBytes) {
  auto app = buildApp(testConfig());
  const std::string meta = R"({"title":"Api Test","pages":[{}]})";
  const auto body = buildMultipart({{"meta", meta}, {"page_0", makeJpeg()}},
                                   {{"page_0", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/pdf/searchable", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  ASSERT_EQ(res.code, 200);
  EXPECT_EQ(res.get_header_value("Content-Type"), "application/pdf");
  EXPECT_EQ(res.body.rfind("%PDF-", 0), 0u);
  EXPECT_NE(res.get_header_value("Content-Disposition").find("Api_Test.pdf"), std::string::npos);
}

TEST(Api, SearchablePdfRequiresMatchingPages) {
  auto app = buildApp(testConfig());
  const std::string meta = R"({"title":"T","pages":[{},{}]})";  // expects two page images
  const auto body = buildMultipart({{"meta", meta}, {"page_0", makeJpeg()}},
                                   {{"page_0", "page.jpg"}});
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/pdf/searchable", body,
                                              "multipart/form-data; boundary=scanly-test-boundary"));
  EXPECT_EQ(res.code, 400);
  EXPECT_EQ(asJson(res).at("error").at("code"), "bad_request");
}

TEST(Api, RejectsMalformedMultipart) {
  auto app = buildApp(testConfig());
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", "not-multipart",
                                              "multipart/form-data; boundary=whatever"));
  EXPECT_EQ(res.code, 400);
  EXPECT_EQ(asJson(res).at("error").at("code"), "bad_request");
}

TEST(Api, RejectsPartWithoutName) {
  auto app = buildApp(testConfig());
  const std::string body =
      "--bnd\r\n"
      "Content-Disposition: form-data\r\n"
      "\r\n"
      "value\r\n"
      "--bnd--\r\n";
  auto res = dispatch(*app, makeRequest(crow::HTTPMethod::POST, "/api/ocr", body,
                                              "multipart/form-data; boundary=bnd"));
  EXPECT_EQ(res.code, 400);
}

}  // namespace
}  // namespace scanly
