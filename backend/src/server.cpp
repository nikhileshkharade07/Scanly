#include "scanly/server.hpp"

#include <crow.h>
#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <tesseract/baseapi.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "scanly/detection.hpp"
#include "scanly/image_process.hpp"
#include "scanly/ocr.hpp"
#include "scanly/pdf.hpp"

namespace scanly {
namespace {

using json = nlohmann::json;

constexpr const char* kVersion = "0.2.0";
constexpr std::uint64_t kMaxPixels = 64ull * 1000 * 1000;  // decompression-bomb guard
constexpr int kMaxPdfPages = 200;
constexpr int kJpegQuality = 90;

// ---------------------------------------------------------------- config

std::string envString(const char* name, const std::string& fallback) {
  const char* value = std::getenv(name);
  return value && *value ? std::string(value) : fallback;
}

std::vector<std::string> splitCommas(const std::string& value) {
  std::vector<std::string> out;
  std::size_t start = 0;
  while (start <= value.size()) {
    const auto comma = value.find(',', start);
    const auto end = comma == std::string::npos ? value.size() : comma;
    std::string piece = value.substr(start, end - start);
    // trim
    while (!piece.empty() && std::isspace(static_cast<unsigned char>(piece.front()))) piece.erase(piece.begin());
    while (!piece.empty() && std::isspace(static_cast<unsigned char>(piece.back()))) piece.pop_back();
    if (!piece.empty()) out.push_back(std::move(piece));
    if (comma == std::string::npos) break;
    start = comma + 1;
  }
  return out;
}

// ---------------------------------------------------------------- responses

std::string ciLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

bool originAllowed(const std::string& origin, const ServerConfig& config) {
  if (origin.empty()) return true;
  return std::find(config.allowedOrigins.begin(), config.allowedOrigins.end(), origin) !=
         config.allowedOrigins.end();
}

void applyCors(crow::response& res, const std::string& origin, const ServerConfig& config) {
  if (!origin.empty() && originAllowed(origin, config)) {
    res.set_header("Access-Control-Allow-Origin", origin);
    res.set_header("Vary", "Origin");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
  }
}

crow::response errorResponse(int status, const std::string& code, const std::string& message) {
  crow::response res(status);
  res.set_header("Content-Type", "application/json");
  res.body = json{{"error", {{"code", code}, {"message", message}}}}.dump();
  return res;
}

// Common gate shared by every handler: CORS preflight, origin allowlist,
// body size cap, multipart content type. Returns a prepared response when
// the request must stop, nullopt to continue.
std::optional<crow::response> precheck(const crow::request& req, const ServerConfig& config) {
  const std::string origin = req.get_header_value("Origin");

  if (req.method == crow::HTTPMethod::OPTIONS) {
    crow::response res(204);
    applyCors(res, origin, config);
    return res;
  }

  if (!originAllowed(origin, config)) {
    auto res = errorResponse(403, "forbidden_origin", "Origin is not allowed to call this API.");
    applyCors(res, origin, config);
    return res;
  }

  const auto contentLength = req.get_header_value("Content-Length");
  if (!contentLength.empty()) {
    try {
      if (std::stoull(contentLength) > config.maxBodyBytes) {
        auto res = errorResponse(413, "too_large", "Request body exceeds the configured size limit.");
        applyCors(res, origin, config);
        return res;
      }
    } catch (...) {
      auto res = errorResponse(400, "bad_request", "Malformed Content-Length header.");
      applyCors(res, origin, config);
      return res;
    }
  }
  if (req.body.size() > config.maxBodyBytes) {
    auto res = errorResponse(413, "too_large", "Request body exceeds the configured size limit.");
    applyCors(res, origin, config);
    return res;
  }

  if (req.method == crow::HTTPMethod::POST &&
      ciLower(req.get_header_value("Content-Type")).rfind("multipart/form-data", 0) != 0) {
    auto res = errorResponse(415, "unsupported_media_type", "Expected multipart/form-data.");
    applyCors(res, origin, config);
    return res;
  }

  return std::nullopt;
}

/** Decorate a successful/failed response with CORS headers before returning. */
crow::response done(crow::response res, const crow::request& req, const ServerConfig& config) {
  applyCors(res, req.get_header_value("Origin"), config);
  return res;
}

// ---------------------------------------------------------------- multipart
//
// Minimal, strict multipart/form-data parser. Crow's own parser dereferences
// a missing Content-Disposition name parameter unconditionally, so we parse
// the body ourselves and reject malformed input with clear errors instead.

struct FormField {
  std::string name;
  std::string filename;
  std::string contentType;
  std::string body;
};

struct ParsedForm {
  std::vector<FormField> fields;
  const FormField* find(const std::string& fieldName) const {
    for (const auto& field : fields) {
      if (field.name == fieldName) return &field;
    }
    return nullptr;
  }
};

std::optional<std::string> extractBoundary(const std::string& contentType) {
  const auto lower = ciLower(contentType);
  const auto pos = lower.find("boundary=");
  if (pos == std::string::npos) return std::nullopt;
  std::string value = contentType.substr(pos + 9);
  if (!value.empty() && value.front() == '"') {
    const auto close = value.find('"', 1);
    if (close == std::string::npos) return std::nullopt;
    return value.substr(1, close - 1);
  }
  const auto semi = value.find(';');
  if (semi != std::string::npos) value = value.substr(0, semi);
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
  if (value.empty()) return std::nullopt;
  return value;
}

std::string trimCopy(const std::string& value) {
  std::size_t begin = 0;
  std::size_t end = value.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(value[begin]))) ++begin;
  while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) --end;
  return value.substr(begin, end - begin);
}

std::string unquoteCopy(const std::string& value) {
  if (value.size() >= 2 && value.front() == '"' && value.back() == '"') {
    return value.substr(1, value.size() - 2);
  }
  return value;
}

bool parseDispositionParams(const std::string& headerValue, FormField& field) {
  // form-data; name="image"; filename="a.png"
  std::size_t pos = headerValue.find(';');
  if (pos == std::string::npos) return false;
  ++pos;
  bool sawName = false;
  while (pos < headerValue.size()) {
    const auto next = headerValue.find(';', pos);
    const std::string piece =
        headerValue.substr(pos, next == std::string::npos ? std::string::npos : next - pos);
    const auto eq = piece.find('=');
    if (eq != std::string::npos) {
      const std::string key = ciLower(trimCopy(piece.substr(0, eq)));
      const std::string val = unquoteCopy(trimCopy(piece.substr(eq + 1)));
      if (key == "name") {
        field.name = val;
        sawName = true;
      } else if (key == "filename") {
        field.filename = val;
      }
    }
    if (next == std::string::npos) break;
    pos = next + 1;
  }
  return sawName && !field.name.empty();
}

bool parseMultipart(const std::string& body, const std::string& contentType, ParsedForm& out,
                    std::string& error) {
  auto boundary = extractBoundary(contentType);
  if (!boundary) {
    error = "Missing multipart boundary.";
    return false;
  }
  if (boundary->size() > 200 || body.size() < 4 + boundary->size()) {
    error = "Malformed multipart body.";
    return false;
  }

  const std::string delimiter = "--" + *boundary;
  std::size_t pos = 0;
  if (body.size() >= 2 && body.compare(0, 2, "\r\n") == 0) pos = 2;

  constexpr std::size_t kMaxFields = 64;
  while (true) {
    if (body.compare(pos, delimiter.size(), delimiter) != 0) {
      error = "Malformed multipart body (expected boundary).";
      return false;
    }
    pos += delimiter.size();
    if (body.compare(pos, 2, "--") == 0) break;  // epilogue
    if (body.compare(pos, 2, "\r\n") != 0) {
      error = "Malformed multipart body (expected CRLF).";
      return false;
    }
    pos += 2;

    const auto headerEnd = body.find("\r\n\r\n", pos);
    if (headerEnd == std::string::npos) {
      error = "Malformed multipart body (missing part headers).";
      return false;
    }
    if (out.fields.size() >= kMaxFields) {
      error = "Too many multipart fields.";
      return false;
    }

    FormField field;
    std::size_t lineStart = pos;
    while (lineStart < headerEnd) {
      const auto lineEnd = body.find("\r\n", lineStart);
      const auto stop = (lineEnd == std::string::npos || lineEnd > headerEnd) ? headerEnd : lineEnd;
      const std::string line = body.substr(lineStart, stop - lineStart);
      const auto colon = line.find(':');
      if (colon != std::string::npos) {
        const std::string key = ciLower(trimCopy(line.substr(0, colon)));
        const std::string value = trimCopy(line.substr(colon + 1));
        if (key == "content-disposition") {
          if (!parseDispositionParams(value, field)) {
            error = "Multipart part is missing a name parameter.";
            return false;
          }
        } else if (key == "content-type") {
          field.contentType = value;
        }
      }
      lineStart = stop + 2;
    }
    if (field.name.empty()) {
      error = "Multipart part is missing a name parameter.";
      return false;
    }

    pos = headerEnd + 4;
    const std::string closer = "\r\n" + delimiter;
    const auto next = body.find(closer, pos);
    if (next == std::string::npos) {
      error = "Malformed multipart body (unterminated part).";
      return false;
    }
    field.body = body.substr(pos, next - pos);
    out.fields.push_back(std::move(field));
    pos = next + 2;
  }
  return true;
}

// ---------------------------------------------------------------- image helpers

std::optional<cv::Mat> decodeImage(const std::string& bytes) {
  if (bytes.empty()) return std::nullopt;
  const cv::Mat buffer(1, static_cast<int>(bytes.size()), CV_8UC1,
                       const_cast<char*>(bytes.data()));
  cv::Mat image = cv::imdecode(buffer, cv::IMREAD_COLOR);
  if (image.empty()) return std::nullopt;
  const std::uint64_t pixels =
      static_cast<std::uint64_t>(image.cols) * static_cast<std::uint64_t>(image.rows);
  if (pixels == 0 || pixels > kMaxPixels) return std::nullopt;
  return image;
}

std::string encodeJpeg(const cv::Mat& image) {
  std::vector<uchar> buffer;
  cv::imencode(".jpg", image, buffer, {cv::IMWRITE_JPEG_QUALITY, kJpegQuality});
  return std::string(reinterpret_cast<const char*>(buffer.data()), buffer.size());
}

const std::vector<std::string>& cachedLanguages() {
  static const std::vector<std::string> languages = [] {
    auto list = availableOcrLanguages();
    if (list.empty()) list.push_back("eng");
    return list;
  }();
  return languages;
}

std::string safePdfFilename(const std::string& title) {
  std::string out;
  for (const char c : title) {
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                    c == '-' || c == '_' || c == ' ';
    out.push_back(ok ? c : '_');
  }
  while (!out.empty() && out.front() == ' ') out.erase(out.begin());
  while (!out.empty() && out.back() == ' ') out.pop_back();
  if (out.empty()) out = "scanly-document";
  if (out.size() > 80) out.resize(80);
  return out + ".pdf";
}

}  // namespace

// ---------------------------------------------------------------- config

ServerConfig configFromEnv() {
  ServerConfig config;
  config.host = envString("SCANLY_HOST", "127.0.0.1");
  if (const char* port = std::getenv("SCANLY_PORT"); port && *port) {
    try {
      const unsigned long value = std::stoul(port);
      if (value > 0 && value <= 65535) config.port = static_cast<uint16_t>(value);
    } catch (...) {
      // keep default
    }
  }
  config.allowedOrigins =
      splitCommas(envString("SCANLY_ALLOWED_ORIGINS",
                            "http://localhost:3000,http://127.0.0.1:3000"));
  if (const char* mb = std::getenv("SCANLY_MAX_UPLOAD_MB"); mb && *mb) {
    try {
      const unsigned long long value = std::stoull(mb);
      if (value >= 1 && value <= 512) config.maxBodyBytes = value * 1024ull * 1024ull;
    } catch (...) {
      // keep default
    }
  }
  return config;
}

// ---------------------------------------------------------------- server

std::unique_ptr<crow::SimpleApp> buildApp(const ServerConfig& config) {
  auto ownedApp = std::make_unique<crow::SimpleApp>();
  crow::SimpleApp& app = *ownedApp;

  const auto health = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    json out;
    out["status"] = "ok";
    out["version"] = kVersion;
    out["engine"] = {{"opencv", CV_VERSION}, {"tesseract", tesseract::TessBaseAPI::Version()}};
    out["languages"] = cachedLanguages();
    crow::response res(200);
    res.set_header("Content-Type", "application/json");
    res.body = out.dump();
    return done(std::move(res), req, config);
  };

  const auto languages = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    crow::response res(200);
    res.set_header("Content-Type", "application/json");
    res.body = json{{"languages", cachedLanguages()}}.dump();
    return done(std::move(res), req, config);
  };

  const auto detect = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    try {
      ParsedForm form;
      std::string parseError;
      if (!parseMultipart(req.body, req.get_header_value("Content-Type"), form, parseError)) {
        return done(errorResponse(400, "bad_request", parseError), req, config);
      }
      const FormField* image = form.find("image");
      if (!image) {
        return done(errorResponse(400, "bad_request", "Missing 'image' field."), req, config);
      }
      auto decoded = decodeImage(image->body);
      if (!decoded) {
        return done(errorResponse(400, "bad_image", "Could not decode the uploaded image."), req,
                    config);
      }
      const Detection detection = detectDocument(*decoded);

      json out;
      out["found"] = detection.found;
      out["confidence"] = detection.confidence;
      out["corners"] = json::array();
      if (detection.found) {
        for (const auto& corner : detection.corners) {
          out["corners"].push_back({corner.x / decoded->cols, corner.y / decoded->rows});
        }
      }
      out["imageWidth"] = decoded->cols;
      out["imageHeight"] = decoded->rows;
      crow::response res(200);
      res.set_header("Content-Type", "application/json");
      res.body = out.dump();
      return done(std::move(res), req, config);
    } catch (const std::exception& e) {
      return done(errorResponse(500, "internal", e.what()), req, config);
    }
  };

  const auto process = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    try {
      ParsedForm form;
      std::string parseError;
      if (!parseMultipart(req.body, req.get_header_value("Content-Type"), form, parseError)) {
        return done(errorResponse(400, "bad_request", parseError), req, config);
      }
      const FormField* image = form.find("image");
      if (!image) {
        return done(errorResponse(400, "bad_request", "Missing 'image' field."), req, config);
      }
      auto decoded = decodeImage(image->body);
      if (!decoded) {
        return done(errorResponse(400, "bad_image", "Could not decode the uploaded image."), req,
                    config);
      }

      ProcessOptions options;
      if (const FormField* raw = form.find("options"); raw && !raw->body.empty()) {
        const json parsed = json::parse(raw->body, nullptr, false);
        if (parsed.is_discarded() || !parsed.is_object()) {
          return done(errorResponse(400, "bad_request", "'options' must be a JSON object."), req,
                      config);
        }
        try {
          if (parsed.contains("corners")) {
            const auto& corners = parsed.at("corners");
            if (!corners.is_array() || corners.size() != 4) {
              return done(errorResponse(400, "bad_request", "'corners' must be 4 [x, y] pairs."),
                          req, config);
            }
            std::array<std::array<double, 2>, 4> quad{};
            for (std::size_t i = 0; i < 4; ++i) {
              const auto& point = corners.at(i);
              if (!point.is_array() || point.size() != 2 || !point.at(0).is_number() ||
                  !point.at(1).is_number()) {
                return done(errorResponse(400, "bad_request", "'corners' must be 4 [x, y] pairs."),
                            req, config);
              }
              quad[i][0] = point.at(0).get<double>();
              quad[i][1] = point.at(1).get<double>();
              if (quad[i][0] < 0 || quad[i][0] > 1 || quad[i][1] < 0 || quad[i][1] > 1) {
                return done(errorResponse(400, "bad_request", "'corners' values must be within [0, 1]."),
                            req, config);
              }
            }
            options.corners = quad;
          }
          if (parsed.contains("filter") && !parsed.at("filter").is_null()) {
            options.filter = parseFilter(parsed.at("filter").get<std::string>());
          }
          if (parsed.contains("rotation") && !parsed.at("rotation").is_null()) {
            options.rotation = parsed.at("rotation").get<int>();
          }
          if (parsed.contains("brightness") && !parsed.at("brightness").is_null()) {
            options.brightness = parsed.at("brightness").get<double>();
          }
          if (parsed.contains("contrast") && !parsed.at("contrast").is_null()) {
            options.contrast = parsed.at("contrast").get<double>();
          }
          if (parsed.contains("maxWidth") && !parsed.at("maxWidth").is_null()) {
            options.maxWidth = parsed.at("maxWidth").get<int>();
          }
        } catch (const nlohmann::json::exception& e) {
          return done(errorResponse(400, "bad_request", std::string("Invalid options: ") + e.what()),
                      req, config);
        } catch (const std::invalid_argument& e) {
          return done(errorResponse(400, "bad_request", e.what()), req, config);
        }
      }

      const cv::Mat processed = processImage(*decoded, options);
      crow::response res(200);
      res.set_header("Content-Type", "image/jpeg");
      res.body = encodeJpeg(processed);
      return done(std::move(res), req, config);
    } catch (const std::invalid_argument& e) {
      return done(errorResponse(400, "bad_request", e.what()), req, config);
    } catch (const cv::Exception& e) {
      return done(errorResponse(400, "bad_image", "Image processing failed."), req, config);
    } catch (const std::exception& e) {
      return done(errorResponse(500, "internal", e.what()), req, config);
    }
  };

  const auto ocr = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    try {
      ParsedForm form;
      std::string parseError;
      if (!parseMultipart(req.body, req.get_header_value("Content-Type"), form, parseError)) {
        return done(errorResponse(400, "bad_request", parseError), req, config);
      }
      const FormField* image = form.find("image");
      if (!image) {
        return done(errorResponse(400, "bad_request", "Missing 'image' field."), req, config);
      }
      std::string language = "eng";
      if (const FormField* raw = form.find("lang"); raw && !raw->body.empty()) {
        language = trimCopy(raw->body);
      }
      const auto& available = cachedLanguages();
      if (std::find(available.begin(), available.end(), language) == available.end()) {
        return done(errorResponse(400, "unsupported_language",
                                  "OCR language data is not installed: " + language),
                    req, config);
      }
      auto decoded = decodeImage(image->body);
      if (!decoded) {
        return done(errorResponse(400, "bad_image", "Could not decode the uploaded image."), req,
                    config);
      }
      const OcrResult result = recognizeText(*decoded, language);
      crow::response res(200);
      res.set_header("Content-Type", "application/json");
      res.body = json(result).dump();
      return done(std::move(res), req, config);
    } catch (const OcrError& e) {
      return done(errorResponse(500, "ocr_failed", e.what()), req, config);
    } catch (const std::exception& e) {
      return done(errorResponse(500, "internal", e.what()), req, config);
    }
  };

  const auto searchablePdf = [&config](const crow::request& req) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    try {
      ParsedForm form;
      std::string parseError;
      if (!parseMultipart(req.body, req.get_header_value("Content-Type"), form, parseError)) {
        return done(errorResponse(400, "bad_request", parseError), req, config);
      }
      const FormField* meta = form.find("meta");
      if (!meta || meta->body.empty()) {
        return done(errorResponse(400, "bad_request", "Missing 'meta' field."), req, config);
      }
      const json parsed = json::parse(meta->body, nullptr, false);
      if (parsed.is_discarded() || !parsed.is_object() || !parsed.contains("pages") ||
          !parsed.at("pages").is_array()) {
        return done(errorResponse(400, "bad_request",
                                  "'meta' must be an object with a 'pages' array."),
                    req, config);
      }
      const auto& pages = parsed.at("pages");
      if (pages.empty()) {
        return done(errorResponse(400, "bad_request", "'pages' must contain at least one page."),
                    req, config);
      }
      if (pages.size() > static_cast<std::size_t>(kMaxPdfPages)) {
        return done(errorResponse(400, "bad_request", "Too many pages in one PDF."), req, config);
      }

      PdfDocumentInput input;
      input.title = parsed.value("title", std::string("Scanly Document"));

      for (std::size_t i = 0; i < pages.size(); ++i) {
        const std::string fieldName = "page_" + std::to_string(i);
        const FormField* pageImage = form.find(fieldName);
        if (!pageImage || pageImage->body.empty()) {
          return done(errorResponse(400, "bad_request", "Missing '" + fieldName + "' field."),
                      req, config);
        }
        PdfPageInput page;
        page.imageBytes = pageImage->body;

        const auto& metaPage = pages.at(i);
        if (metaPage.is_object() && metaPage.contains("ocr") && !metaPage.at("ocr").is_null()) {
          try {
            page.ocr = metaPage.at("ocr").get<OcrResult>();
          } catch (const nlohmann::json::exception& e) {
            return done(errorResponse(400, "bad_request",
                                      "Invalid OCR data for " + fieldName + ": " + e.what()),
                        req, config);
          }
        }
        input.pages.push_back(std::move(page));
      }

      const std::string pdfBytes = buildSearchablePdf(input);
      crow::response res(200);
      res.set_header("Content-Type", "application/pdf");
      res.set_header("Content-Disposition",
                     "attachment; filename=\"" + safePdfFilename(input.title) + "\"");
      res.body = pdfBytes;
      return done(std::move(res), req, config);
    } catch (const PdfError& e) {
      return done(errorResponse(500, "pdf_failed", e.what()), req, config);
    } catch (const nlohmann::json::exception& e) {
      return done(errorResponse(400, "bad_request", std::string("Invalid meta JSON: ") + e.what()),
                  req, config);
    } catch (const std::exception& e) {
      return done(errorResponse(500, "internal", e.what()), req, config);
    }
  };

  // The /<path> wildcard captures the remaining path segments as an argument.
  const auto catchAll = [&config](const crow::request& req, const std::string&) -> crow::response {
    if (auto stopped = precheck(req, config)) return done(std::move(*stopped), req, config);
    return done(errorResponse(404, "not_found", "Unknown API endpoint."), req, config);
  };

  CROW_ROUTE(app, "/api/health").methods(crow::HTTPMethod::GET)(health);
  CROW_ROUTE(app, "/api/ocr/languages").methods(crow::HTTPMethod::GET)(languages);
  CROW_ROUTE(app, "/api/vision/detect").methods(crow::HTTPMethod::POST)(detect);
  CROW_ROUTE(app, "/api/image/process").methods(crow::HTTPMethod::POST)(process);
  CROW_ROUTE(app, "/api/ocr").methods(crow::HTTPMethod::POST)(ocr);
  CROW_ROUTE(app, "/api/pdf/searchable").methods(crow::HTTPMethod::POST)(searchablePdf);
  // Unknown paths and preflight OPTIONS fall through here. Static routes win
  // over this catch-all in Crow's router.
  CROW_ROUTE(app, "/<path>")
      .methods(crow::HTTPMethod::GET, crow::HTTPMethod::POST, crow::HTTPMethod::OPTIONS)(
      catchAll);

  // Default Crow access log prints method/path/status/duration only — no
  // bodies, no OCR text, no document bytes (privacy rule).
  app.loglevel(crow::LogLevel::Info);

  return ownedApp;
}

int runServer(const ServerConfig& config) {
  std::unique_ptr<crow::SimpleApp> app = buildApp(config);
  try {
    app->bindaddr(config.host).port(config.port).multithreaded().run();
  } catch (const std::exception& e) {
    fprintf(stderr, "scanly_server failed to start: %s\n", e.what());
    return 1;
  }
  return 0;
}

}  // namespace scanly
