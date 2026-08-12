'use strict';

//#region 필요한 외부 모듈

//#endregion

//#region 로컬 modules

const logger = require('../../utility/logger.js')('QuizUI');
const { QuizInfoUI } = require('./quiz-info-ui');
//dev-quiz-select-ui.ts는 이 파일을 require한다(handleContentSelected에서 DevQuizInfoUI 생성) - 여기서
//top-level로 require하면 순환 require가 되어, 나중에 로드되는 쪽이 텅 빈 module.exports를 캡처해버린다
//(실제로 겪은 버그: DevQuizSelectUI가 undefined로 잡혀서 buildDevQuizInfoFromWebPayload 호출 시 TypeError,
//test/quiz_ui/dev_quiz_web_reapply.test.js가 이 회귀를 잡음).
//이 값은 onReceivedWebSessionSignal 안에서만 쓰이므로, 모듈 로드가 전부 끝난 뒤(이벤트 발생 시점)
//호출되도록 require를 함수 안으로 미뤄서 순환을 피한다.

//#endregion

/** 공식 퀴즈용 퀴즈 정보 UI*/
/** 단순히 래핑 클래스임 */
class DevQuizInfoUI extends QuizInfoUI
{
  constructor(quiz_info: any)
  {
    super(quiz_info);

    this.refreshUI();
  }

  //퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md, 2026-08-08) - "선택 완료" 이후에도 웹 세션 토큰은
  //살아있어서(퀴즈가 실제 시작되거나 홀더가 사라질 때 파기됨), 웹에서 문제 수를 재조정하거나 다른
  //퀴즈를 다시 확정하면 이 화면에 그대로 반영해야 한다. 새 UI 인스턴스로 안 바꾸고 같은 인스턴스를
  //갱신하는 이유: 새 인스턴스를 반환하면 매번 prev_ui_stack에 쌓여서 "뒤로가기"가 이전 웹 재선택
  //내역을 하나씩 되짚게 되는 부작용이 있음(원래 의도는 SelectQuizTypeUI로 바로 복귀).
  onReceivedWebSessionSignal(signal: any): any
  {
    if(signal.event !== 'applied')
    {
      return undefined;
    }

    const { DevQuizSelectUI } = require('./dev-quiz-select-ui'); //순환 require 회피 - 파일 상단 주석 참고
    const dev_quiz_info = DevQuizSelectUI.buildDevQuizInfoFromWebPayload(signal.payload);
    if(dev_quiz_info === undefined)
    {
      logger.error(`Web-selected dev quiz content not found on reapply. content_path:${signal.payload?.content_path}`);
      return undefined;
    }

    this.quiz_info = dev_quiz_info;
    this.embed.title = `${dev_quiz_info['icon'] ?? ''} ${dev_quiz_info['title'] ?? ''}`;
    this.embed.thumbnail = { url: dev_quiz_info['thumbnail'] ?? '' };
    this.embed.footer = { text: dev_quiz_info['author'] ?? '', icon_url: dev_quiz_info['author_icon'] ?? '' };
    this.refreshUI();
    this.update();

    return this;
  }
}

module.exports = { DevQuizInfoUI };
