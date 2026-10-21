#include <cstdio>

#include "scanly/server.hpp"

int main() {
  const scanly::ServerConfig config = scanly::configFromEnv();
  std::printf("scanly_server %s:%u (body limit %zu MB)\n", config.host.c_str(),
              static_cast<unsigned>(config.port), config.maxBodyBytes / (1024 * 1024));
  return scanly::runServer(config);
}
