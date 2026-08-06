'use strict';
//TS_MIGRATION_AND_CONVENIENCE_PLAN.md A-2 빌드 파이프라인.
//tsc는 tsconfig.json의 include에 있는 .ts 파일만 컴파일한다(moduleDetection:"force"가
//.js 파일에도 적용되면 원본에 없던 'use strict'가 강제로 삽입되는 문제가 있어서
//.js는 tsc의 컴파일 대상에서 아예 뺐음, tsconfig.json 주석 참고).
//대신 이 스크립트가 아직 .ts로 전환 안 한 .js/.json 파일들을 dist/에 원본 그대로
//(byte-for-byte) 복사한다.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'dist');

const SOURCE_DIRS = ['quizbot', 'utility', 'config'];
const COPY_EXTENSIONS = ['.js', '.json'];

let copied_count = 0;

const copyRecursive = (src_dir, dest_dir) =>
{
  if (fs.existsSync(src_dir) === false)
  {
    return;
  }

  fs.mkdirSync(dest_dir, { recursive: true });

  for (const entry of fs.readdirSync(src_dir, { withFileTypes: true }))
  {
    const src_path = path.join(src_dir, entry.name);
    const dest_path = path.join(dest_dir, entry.name);

    if (entry.isDirectory())
    {
      copyRecursive(src_path, dest_path);
      continue;
    }

    if (COPY_EXTENSIONS.includes(path.extname(entry.name)))
    {
      fs.copyFileSync(src_path, dest_path);
      ++copied_count;
    }
  }
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.copyFileSync(path.join(ROOT_DIR, 'index.js'), path.join(OUT_DIR, 'index.js'));
++copied_count;

for (const dir_name of SOURCE_DIRS)
{
  copyRecursive(path.join(ROOT_DIR, dir_name), path.join(OUT_DIR, dir_name));
}

console.log(`copy-js-assets: ${copied_count}개 파일을 dist/로 복사 완료`);
