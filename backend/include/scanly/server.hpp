#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <crow.h>

namespace scanly {

struct ServerConfig {
  std::string host = "127.0.0.1";
  uint16_t port = 8080;
  std::vector<std::string> allowedOrigins;
  std::size_t maxBodyBytes = 25ull * 1024 * 1024;
};

/** Read config from environment (SCANLY_HOST, SCANLY_PORT, SCANLY_ALLOWED_ORIGINS, SCANLY_MAX_UPLOAD_MB). */
ServerConfig configFromEnv();

/**
 * Build the fully routed Crow app for a config. Exposed so tests can drive
 * requests in-process via handle_full() without binding a socket.
 */
std::unique_ptr<crow::SimpleApp> buildApp(const ServerConfig& config);

/**
 * Run the Crow HTTP server (blocking). Returns a process exit code.
 * Routes: /api/health, /api/ocr/languages, /api/vision/detect,
 * /api/image/process, /api/ocr, /api/pdf/searchable.
 */
int runServer(const ServerConfig& config);

}  // namespace scanly
