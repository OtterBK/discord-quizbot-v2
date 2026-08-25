'use strict';

//랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md, 2026-08-13 신설) - 웹 UI 한정, "직접 담기"
//모드의 퀴즈함(quiz_id 목록)만 유저(user_id) 단위로 저장한다(옵션은 저장하지 않음). tb_random_quiz_preset
//(메타) + tb_random_quiz_preset_item(항목, sort_order로 순서 보존) 두 테이블로 분리 - 배열 컬럼을 안 쓰는
//기존 관행(tb_like_info 등 연결 테이블 패턴)을 따르고, 퀴즈가 실제로 삭제되면 FK ON DELETE CASCADE로
//항목이 자동 정리된다. is_private 전환처럼 soft한 무효화는 여기서 걸러지지 않음 - 호출부(web_express_app.ts)가
//이미 불러온 공개 퀴즈 목록(/api/user-quizzes)과 대조해서 거른다(계획 문서의 "앱 코드 레벨" 항목 참고).

const db_core = require('./db_core');

exports.selectRandomQuizPresetsByUser = async (user_id: string): Promise<any> =>
{

  let query_string =
  `select p.preset_id, p.preset_name, p.created_time, p.modified_time,
    coalesce(array_agg(i.quiz_id order by i.sort_order) filter (where i.quiz_id is not null), '{}') as quiz_id_list
    from tb_random_quiz_preset p
    left join tb_random_quiz_preset_item i on i.preset_id = p.preset_id
    where p.user_id = $1
    group by p.preset_id
    order by p.created_time asc`;

  return db_core.sendQuery(query_string, [user_id]);

};

exports.selectRandomQuizPresetByName = async (user_id: string, preset_name: string): Promise<any> =>
{

  let query_string =
  `select preset_id
    from tb_random_quiz_preset
    where user_id = $1 and preset_name = $2`;

  return db_core.sendQuery(query_string, [user_id, preset_name]);

};

exports.countRandomQuizPresetsByUser = async (user_id: string): Promise<any> =>
{

  let query_string =
  `select count(*) as count
    from tb_random_quiz_preset
    where user_id = $1`;

  return db_core.sendQuery(query_string, [user_id]);

};

//preset 메타 1건 + item 목록을 한 번에 만든다. 트랜잭션 없이 2단계 INSERT라(db_core.ts에 트랜잭션
//헬퍼가 없고, 이 코드베이스는 기존에도 다단계 저장을 트랜잭션으로 묶지 않는 관행) item 삽입이 실패하면
//방금 만든 빈 preset 행이 고아로 남지 않도록 직접 정리한다.
//
//max_count(호출부의 RANDOM_QUIZ_PRESET_MAX_COUNT)를 INSERT 자체의 WHERE 절에도 넣는 이유 - 호출부가
//먼저 countRandomQuizPresetsByUser로 개수를 확인한 뒤 이 함수를 호출하는데, 그 사이(별도 요청 2개)
//동시에 여러 번 호출되면(API를 프론트엔드 없이 직접 두들기는 경우) 둘 다 "9개"를 보고 통과해 10개
//제한을 넘길 수 있다(TOCTOU) - INSERT ... SELECT ... WHERE (SELECT COUNT...) < $3 형태로 조건을
//같은 SQL 문 안에 넣어 순수 애플리케이션 레벨 체크보다 창을 훨씬 좁힌다(완벽한 직렬화는 아님 - 정말
//동시에 실행되는 두 statement가 서로의 커밋 전 상태를 볼 순 없어 극히 드물게는 여전히 넘을 수 있으나,
//이 정도 제한은 유저 본인 데이터에 대한 소프트 쿼터라 완전한 직렬화(SERIALIZABLE/명시적 락)까지는
//과함 - db_core.ts에 트랜잭션/락 인프라 자체가 없기도 함).
exports.insertRandomQuizPreset = async (user_id: string, preset_name: string, quiz_id_list: number[], max_count: number): Promise<any> =>
{

  let insert_preset_query =
  `insert into tb_random_quiz_preset (user_id, preset_name)
    select $1, $2
    where (select count(*) from tb_random_quiz_preset where user_id = $1) < $3
    returning preset_id`;

  const preset_result = await db_core.sendQuery(insert_preset_query, [user_id, preset_name, max_count]);
  if(preset_result == undefined || preset_result.rows.length == 0)
  {
    return undefined;
  }

  const preset_id = preset_result.rows[0].preset_id;

  //quiz_id_list의 배열 순서를 sort_order로 그대로 옮겨담는다(unnest ... with ordinality) - 항목 수만큼
  //플레이스홀더를 만드는 기존 insertQuizInfo류 패턴 대신, 배열 파라미터 하나로 한 번에 삽입한다.
  let insert_items_query =
  `insert into tb_random_quiz_preset_item (preset_id, quiz_id, sort_order)
    select $1, quiz_id, ordinality - 1
    from unnest($2::int[]) with ordinality as t(quiz_id, ordinality)`;

  const items_result = await db_core.sendQuery(insert_items_query, [preset_id, quiz_id_list]);
  if(items_result == undefined)
  {
    await db_core.sendQuery('delete from tb_random_quiz_preset where preset_id = $1', [preset_id]);
    return undefined;
  }

  return preset_id;

};

exports.deleteRandomQuizPreset = async (preset_id: number, user_id: string): Promise<any> =>
{

  //user_id까지 조건에 넣어 소유권을 DB 레벨에서 강제(db_quiz.ts의 selectOwnedQuizInfoById와 동일 관행) -
  //다른 유저의 preset_id를 넘겨도 0 row 삭제로 끝나 404 처리된다.
  let query_string =
  `delete from tb_random_quiz_preset
    where preset_id = $1 and user_id = $2
    returning preset_id`;

  return db_core.sendQuery(query_string, [preset_id, user_id]);

};

//디스코드 프리셋 관리 UI(2026-08-18 신설, docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md) 전용 - 이름 변경.
//웹 UI엔 아직 이 기능이 없음(저장/불러오기/삭제 3개뿐) - 디스코드가 먼저 갖게 된 기능.
exports.updateRandomQuizPresetName = async (preset_id: number, user_id: string, preset_name: string): Promise<any> =>
{

  let query_string =
  `update tb_random_quiz_preset
    set preset_name = $3, modified_time = now()
    where preset_id = $1 and user_id = $2
    returning preset_id`;

  return db_core.sendQuery(query_string, [preset_id, user_id, preset_name]);

};

//디스코드 프리셋 관리 UI 전용 - 저장된 프리셋에서 항목 하나만 제거(프리셋 자체는 안 지움, 웹 UI엔 아직
//없는 기능). tb_random_quiz_preset_item엔 user_id가 없어 tb_random_quiz_preset과 조인해서 소유권을
//강제한다(deleteRandomQuizPreset과 동일한 "다른 유저 소유면 0 row" 관행).
exports.deleteRandomQuizPresetItem = async (preset_id: number, user_id: string, quiz_id: number): Promise<any> =>
{

  let query_string =
  `delete from tb_random_quiz_preset_item i
    using tb_random_quiz_preset p
    where i.preset_id = p.preset_id and i.preset_id = $1 and p.user_id = $2 and i.quiz_id = $3
    returning i.preset_id`;

  return db_core.sendQuery(query_string, [preset_id, user_id, quiz_id]);

};

//기존 프리셋에 퀴즈를 "추가"하는 기능(웹 프리셋 관리 페이지, 2026-08-20 신설) 전용 - 항목 목록을
//통째로 교체한다(개별 추가/제거 대신 클라이언트가 최종 quiz_id_list를 계산해 넘기는 방식,
//insertRandomQuizPreset의 item 삽입부와 동일한 unnest with ordinality 패턴 재사용). 트랜잭션 없이
//delete 후 insert 2단계라(이 코드베이스의 기존 관행, insertRandomQuizPreset 주석 참고) insert가
//실패하면 그 프리셋은 일시적으로 빈 채로 남을 수 있음 - 항목 목록 저장이라는 낮은 위험도의 개인
//데이터라 트랜잭션/락 인프라 도입까지는 과하다고 판단.
//
//먼저 preset_id/user_id 소유권을 확인해(다른 유저 소유면 undefined 반환, deleteRandomQuizPreset과
//동일 관행) 없는 프리셋에 조용히 item을 꽂아넣는 일이 없게 한다.
exports.replaceRandomQuizPresetItems = async (preset_id: number, user_id: string, quiz_id_list: number[]): Promise<any> =>
{

  const owner_check_query =
  `select preset_id
    from tb_random_quiz_preset
    where preset_id = $1 and user_id = $2`;

  const owner_check = await db_core.sendQuery(owner_check_query, [preset_id, user_id]);
  if(owner_check == undefined || owner_check.rows.length == 0)
  {
    return undefined;
  }

  const delete_result = await db_core.sendQuery('delete from tb_random_quiz_preset_item where preset_id = $1', [preset_id]);
  if(delete_result == undefined)
  {
    return undefined;
  }

  let insert_items_query =
  `insert into tb_random_quiz_preset_item (preset_id, quiz_id, sort_order)
    select $1, quiz_id, ordinality - 1
    from unnest($2::int[]) with ordinality as t(quiz_id, ordinality)`;

  const items_result = await db_core.sendQuery(insert_items_query, [preset_id, quiz_id_list]);
  if(items_result == undefined)
  {
    return undefined;
  }

  await db_core.sendQuery('update tb_random_quiz_preset set modified_time = now() where preset_id = $1', [preset_id]);

  return preset_id;

};
