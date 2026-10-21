#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace scanly {

struct BBox {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
};

struct OcrWord {
  std::string id;
  std::string text;
  double confidence = 0;
  BBox bbox;
};

struct OcrLine {
  std::string id;
  std::string text;
  double confidence = 0;
  BBox bbox;
  std::vector<OcrWord> words;
};

struct OcrBlock {
  std::string id;
  std::string type;
  std::string text;
  double confidence = 0;
  BBox bbox;
  std::vector<OcrLine> lines;
};

struct OcrResult {
  std::string text;
  double confidence = 0;
  int width = 0;
  int height = 0;
  std::vector<OcrBlock> blocks;
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(BBox, x, y, width, height)
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(OcrWord, id, text, confidence, bbox)
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(OcrLine, id, text, confidence, bbox, words)
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(OcrBlock, id, type, text, confidence, bbox, lines)

inline void to_json(nlohmann::json& j, const OcrResult& r) {
  j = nlohmann::json{{"text", r.text},
                     {"confidence", r.confidence},
                     {"width", r.width},
                     {"height", r.height},
                     {"blocks", r.blocks}};
}

inline void from_json(const nlohmann::json& j, OcrResult& r) {
  j.at("text").get_to(r.text);
  j.at("confidence").get_to(r.confidence);
  if (j.contains("width")) j.at("width").get_to(r.width);
  if (j.contains("height")) j.at("height").get_to(r.height);
  j.at("blocks").get_to(r.blocks);
}

}  // namespace scanly
