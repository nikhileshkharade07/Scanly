#include "scanly/ocr.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <opencv2/imgproc.hpp>
#include <tesseract/baseapi.h>
#include <tesseract/resultiterator.h>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace scanly {
namespace {

std::string trimCopy(const std::string& value) {
  const auto begin = value.find_first_not_of(" \t\r\n");
  if (begin == std::string::npos) return "";
  const auto end = value.find_last_not_of(" \t\r\n");
  return value.substr(begin, end - begin + 1);
}

bool fileExists(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  return stream.good();
}

std::string trimmedEnv(const char* name) {
  const char* value = std::getenv(name);
  if (!value || !*value) return "";
  std::string dir(value);
  while (!dir.empty() && (dir.back() == '/' || dir.back() == '\\')) dir.pop_back();
  return dir;
}

/** Directory of the running executable, used to find a bundled tessdata tree. */
std::string executableDir() {
#if defined(_WIN32)
  char buffer[MAX_PATH] = {};
  const DWORD length = GetModuleFileNameA(nullptr, buffer, MAX_PATH);
  if (length == 0 || length >= MAX_PATH) return "";
  std::string path(buffer, length);
  const auto slash = path.find_last_of("/\\");
  return slash == std::string::npos ? "" : path.substr(0, slash);
#elif defined(__linux__)
  std::string path(4096, '\0');
  const ssize_t length = readlink("/proc/self/exe", &path[0], path.size() - 1);
  if (length <= 0) return "";
  path.resize(static_cast<std::size_t>(length));
  const auto slash = path.find_last_of('/');
  return slash == std::string::npos ? "" : path.substr(0, slash);
#else
  return "";
#endif
}

/**
 * Resolve the directory Tesseract should read <language>.traineddata from.
 * Tesseract accepts a prefix and looks for "<prefix>/<lang>.traineddata", so a
 * candidate may be either the tessdata directory itself or its parent (the form
 * TESSDATA_PREFIX traditionally uses). Returns "" when nothing matches, which
 * leaves Tesseract to fall back to its own search.
 */
std::string resolveTessdataDir(const std::string& language) {
  const std::string suffix = "/" + language + ".traineddata";
  const auto accept = [&suffix](const std::string& prefix) -> std::string {
    if (prefix.empty()) return "";
    if (fileExists(prefix + suffix)) return prefix;
    const std::string nested = prefix + "/tessdata";
    return fileExists(nested + suffix) ? nested : "";
  };

  // Explicit override first, then the standard variable, then conventional
  // locations relative to the executable and on disk.
  const std::string candidates[] = {trimmedEnv("SCANLY_TESSDATA"),
                                    trimmedEnv("TESSDATA_PREFIX"),
                                    executableDir() + "/../share/tessdata",
                                    executableDir() + "/tessdata",
                                    "/usr/local/share/tessdata",
                                    "/usr/share/tessdata"};
  for (const auto& candidate : candidates) {
    const std::string dir = accept(candidate);
    if (!dir.empty()) return dir;
  }
  return "";
}

BBox toBBox(const int* box) {
  BBox bbox;
  bbox.x = box[0];
  bbox.y = box[1];
  bbox.width = std::max(0, box[2] - box[0]);
  bbox.height = std::max(0, box[3] - box[1]);
  return bbox;
}

std::string blockTypeName(tesseract::PolyBlockType type) {
  switch (type) {
    case tesseract::PT_HEADING_TEXT: return "heading";
    case tesseract::PT_TABLE: return "table";
    default: return "text";
  }
}

// Unique owner for GetUTF8Text()'s heap strings.
using TextBuffer = std::unique_ptr<char[]>;

std::string textAt(tesseract::ResultIterator& iterator, tesseract::PageIteratorLevel level) {
  TextBuffer buffer(iterator.GetUTF8Text(level));
  if (!buffer) return "";
  return trimCopy(std::string(buffer.get()));
}

bool skipBlock(tesseract::ResultIterator& iterator) {
  const auto type = iterator.BlockType();
  return type == tesseract::PT_NOISE || iterator.Empty(tesseract::RIL_BLOCK);
}

}  // namespace

std::vector<std::string> availableOcrLanguages() {
  // Probe with the most common language; a missing "eng" pack means no OCR data.
  const std::string dataDir = resolveTessdataDir("eng");
  tesseract::TessBaseAPI api;
  if (api.Init(dataDir.empty() ? nullptr : dataDir.c_str(), "eng") != 0) return {};
  std::vector<std::string> languages;
  // Fills a vector of installed language codes (e.g. "eng", "osd").
  api.GetAvailableLanguagesAsVector(&languages);
  languages.erase(std::remove(languages.begin(), languages.end(), std::string()), languages.end());
  std::sort(languages.begin(), languages.end());
  return languages;
}

OcrResult recognizeText(const cv::Mat& image, const std::string& language) {
  if (image.empty()) throw OcrError("Empty image");

  const std::string dataDir = resolveTessdataDir(language);
  tesseract::TessBaseAPI api;
  if (api.Init(dataDir.empty() ? nullptr : dataDir.c_str(), language.c_str()) != 0) {
    throw OcrError("OCR language data not available: " + language);
  }
  api.SetPageSegMode(tesseract::PSM_AUTO);

  cv::Mat gray;
  if (image.channels() == 3) {
    cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
  } else if (image.channels() == 4) {
    cv::cvtColor(image, gray, cv::COLOR_BGRA2GRAY);
  } else {
    gray = image;
  }
  // Tesseract expects a contiguous 8-bit gray buffer:
  // SetImage(data, width, height, bytes_per_pixel, bytes_per_line).
  cv::Mat grayContig = gray.isContinuous() ? gray : gray.clone();
  api.SetImage(grayContig.data, grayContig.cols, grayContig.rows, 1,
               static_cast<int>(grayContig.step));

  if (api.Recognize(nullptr) != 0) {
    throw OcrError("Tesseract recognition failed");
  }

  OcrResult result;
  result.width = image.cols;
  result.height = image.rows;

  TextBuffer fullText(api.GetUTF8Text());
  if (fullText) result.text = trimCopy(std::string(fullText.get()));

  double confidenceSum = 0;
  double confidenceWeight = 0;

  std::unique_ptr<tesseract::ResultIterator> iterator(api.GetIterator());
  if (!iterator) {
    // No text found is a valid outcome (empty result with zero confidence).
    return result;
  }

  int blockIndex = 0;
  for (bool blockValid = true; blockValid; blockValid = iterator->Next(tesseract::RIL_BLOCK)) {
    if (skipBlock(*iterator)) continue;

    OcrBlock block;
    block.id = "b" + std::to_string(blockIndex);
    block.type = blockTypeName(iterator->BlockType());
    block.text = textAt(*iterator, tesseract::RIL_BLOCK);
    block.confidence = iterator->Confidence(tesseract::RIL_BLOCK);
    int blockBox[4];
    if (iterator->BoundingBox(tesseract::RIL_BLOCK, &blockBox[0], &blockBox[1], &blockBox[2], &blockBox[3])) {
      block.bbox = toBBox(blockBox);
    }

    int lineIndex = 0;
    for (bool lineValid = true; lineValid; lineValid = iterator->Next(tesseract::RIL_TEXTLINE)) {
      if (iterator->Empty(tesseract::RIL_TEXTLINE)) continue;

      OcrLine line;
      line.id = block.id + "l" + std::to_string(lineIndex);
      line.text = textAt(*iterator, tesseract::RIL_TEXTLINE);
      line.confidence = iterator->Confidence(tesseract::RIL_TEXTLINE);
      int lineBox[4];
      if (iterator->BoundingBox(tesseract::RIL_TEXTLINE, &lineBox[0], &lineBox[1], &lineBox[2], &lineBox[3])) {
        line.bbox = toBBox(lineBox);
      }

      int wordIndex = 0;
      for (bool wordValid = true; wordValid; wordValid = iterator->Next(tesseract::RIL_WORD)) {
        if (iterator->Empty(tesseract::RIL_WORD)) continue;
        std::string wordText = textAt(*iterator, tesseract::RIL_WORD);
        if (wordText.empty()) continue;

        OcrWord word;
        word.id = line.id + "w" + std::to_string(wordIndex++);
        word.text = wordText;
        word.confidence = iterator->Confidence(tesseract::RIL_WORD);
        int wordBox[4];
        if (iterator->BoundingBox(tesseract::RIL_WORD, &wordBox[0], &wordBox[1], &wordBox[2], &wordBox[3])) {
          word.bbox = toBBox(wordBox);
        }
        confidenceSum += word.confidence;
        confidenceWeight += 1.0;
        line.words.push_back(std::move(word));
      }

      if (!line.words.empty()) {
        block.lines.push_back(std::move(line));
        ++lineIndex;
      }
    }

    if (!block.lines.empty()) {
      result.blocks.push_back(std::move(block));
      ++blockIndex;
    }
  }

  result.confidence = confidenceWeight > 0 ? confidenceSum / confidenceWeight : 0.0;
  return result;
}

}  // namespace scanly
