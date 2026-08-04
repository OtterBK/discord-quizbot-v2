'use strict';

//utility.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//특정 도메인에 묶이지 않는 범용 유틸 함수 모음(난수, 정렬, 문자열/URL 검증, 태그 값 계산 등).
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QUIZ_TAG } = require('../../config/system_setting.js');

exports.getRandom = (min, max) => 
{
  return Math.floor(Math.random() * (max - min + 1)) + min;
};
exports.sleep = (duration) => 
{
  return new Promise((resolve, reject) => 
  {
    setTimeout(() => 
    {
      resolve(); 
    }, duration);
  });
};
exports.sortDictByValue = (dict_obj) => 
{
  const sorted_array = Object.keys(dict_obj).map(k => ([k, dict_obj[k]])).sort((a, b) => (b[1] - a[1]));
  let sorted_dict = {};
  sorted_array.forEach(iter => 
  {
    sorted_dict[iter[0]] = iter[1];
  });

  return sorted_dict;
};
exports.sortMapByProperty = (map, property) => 
{
  return new Map(
    Array.from(map).sort((a, b) => b[1][property] - a[1][property])
  );
};
exports.isImageFile = (file_name) => 
{ //그냥 확장자로 확인해도 된다.
  if (file_name.endsWith(".png") || file_name.endsWith(".jpg") || file_name.endsWith(".gif") || file_name.endsWith(".PNG") || file_name.endsWith(".webp")) 
  {
    return true;
  }
  return false;
};
exports.isValidURL = (url) => 
{
  try 
  {
    if (url == undefined || url.length == 0 || url.endsWith(".webp") == true || (url.startsWith("http://") == false && url.startsWith("https://") == false) || url.includes(".") == false) //webp는 사용 불가
    {
      return false;
    }

    const test_url = new URL(url);
    return true;
  }
  catch (err) 
  {
    return false;
  }
};
exports.convertTagsValueToString = (tags_value, TAG_INFO = QUIZ_TAG) => 
{
  let tag_string = '';
  for (const [tag_name, tag_value] of Object.entries(TAG_INFO)) 
  {
    if(tag_value === 0)
    {
      continue;
    }

    if ((tags_value & tag_value) != tag_value) 
    {
      continue;
    }
    tag_string += tag_name + ', ';
  }

  return tag_string;
};
exports.extractYoutubeVideoID = (url) => 
{
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|.+\/.+\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : undefined;
};
exports.generateUUID = () => //UUID v4 형식
{
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) 
  {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};
exports.calcTagsValue = (values) =>
{
  return values.reduce((acc, tag_value) => acc + parseInt(tag_value), 0);
};
exports.removeMarkdownSpecialChars = (str) => 
{
  // Markdown 특수문자를 제거하는 정규식
  // eslint-disable-next-line no-useless-escape
  const markdownSpecialChars = /[*`_~#\[\]\(\)\{\}><|!.\-+]/g;
  return str.replace(markdownSpecialChars, '');
};
// 닉네임 마크다운 인젝션 & 멘션 방지 함수
exports.sanitizeName = (name) => {
    if (!name) return name;
    // 1. 백틱(`)을 작은따옴표(')로 변경하여 코드블럭 탈출 방지
    // 2. @ 기호 뒤에 눈에 보이지 않는 공백(Zero-width space)을 삽입하여 멘션 기능 무력화
    return name.replace(/`/g, "'").replace(/@/g, "@\u200b");
};