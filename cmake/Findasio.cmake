# MSYS2's mingw-w64-ucrt-x86_64-asio ships headers only (no asio-config.cmake),
# but Crow's CMakeLists does find_package(asio REQUIRED) expecting asio::asio.
# This module locates the headers and provides that target.
find_path(ASIO_INCLUDE_DIR
  NAMES asio.hpp
  PATH_SUFFIXES include
  PATHS
    "$ENV{MINGW_PREFIX}/include"
    "C:/msys64/ucrt64/include"
    "C:/msys64/mingw64/include"
)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(asio DEFAULT_MSG ASIO_INCLUDE_DIR)

if(asio_FOUND AND NOT TARGET asio::asio)
  add_library(asio::asio INTERFACE IMPORTED)
  set_target_properties(asio::asio PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${ASIO_INCLUDE_DIR}")
endif()

mark_as_advanced(ASIO_INCLUDE_DIR)
