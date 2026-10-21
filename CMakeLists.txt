cmake_minimum_required(VERSION 3.21)
project(scanly LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# MSYS2 asio ships headers without a CMake config; this shim provides asio::asio
# for Crow's find_package(asio REQUIRED).
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

find_package(Threads REQUIRED)
find_package(OpenCV REQUIRED COMPONENTS core imgproc imgcodecs geometry)
find_package(PkgConfig REQUIRED)
pkg_check_modules(Tesseract REQUIRED IMPORTED_TARGET tesseract)
find_package(nlohmann_json REQUIRED)
find_package(podofo REQUIRED)

include(FetchContent)
set(CROW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(CROW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(CROW_BUILD_FUZZER OFF CACHE BOOL "" FORCE)
set(CROW_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(Crow
  GIT_REPOSITORY https://github.com/CrowCpp/Crow.git
  GIT_TAG v1.3.5
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(Crow)

add_library(scanly_core STATIC
  backend/src/detection.cpp
  backend/src/image_process.cpp
  backend/src/ocr.cpp
  backend/src/pdf.cpp)
target_include_directories(scanly_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/backend/include)
target_include_directories(scanly_core PUBLIC ${OpenCV_INCLUDE_DIRS})
target_link_libraries(scanly_core PUBLIC
  ${OpenCV_LIBS}
  PkgConfig::Tesseract
  nlohmann_json::nlohmann_json
  podofo::podofo
  Threads::Threads)
target_compile_definitions(scanly_core PUBLIC
  _WIN32_WINNT=0x0A00
  WIN32_LEAN_AND_MEAN
  NOMINMAX)

add_library(scanly_http STATIC backend/src/server.cpp)
target_include_directories(scanly_http PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/backend/include)
target_link_libraries(scanly_http PUBLIC scanly_core Crow::Crow)
if(WIN32)
  target_link_libraries(scanly_http PUBLIC ws2_32 mswsock bcrypt)
endif()

add_executable(scanly_server backend/src/main.cpp)
target_link_libraries(scanly_server PRIVATE scanly_http)

enable_testing()
find_package(GTest REQUIRED)
add_executable(scanly_tests
  backend/tests/detection_test.cpp
  backend/tests/image_process_test.cpp
  backend/tests/ocr_test.cpp
  backend/tests/pdf_test.cpp
  backend/tests/api_test.cpp)
target_link_libraries(scanly_tests PRIVATE scanly_http GTest::gtest_main)
if(WIN32)
  target_link_libraries(scanly_tests PRIVATE ws2_32 mswsock bcrypt)
endif()
include(GoogleTest)
gtest_discover_tests(scanly_tests)
