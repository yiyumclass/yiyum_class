import type { SaleFact } from "@/lib/store/public-sale";

/**
 * 컨설팅 상세 원고.
 *
 * 관리자 편집 대상이 아니다. 판매 문구는 한 번 확정되면 자주 바뀌지 않는 반면,
 * 문구마다 편집 화면을 붙이면 유형이 늘 때마다 그 화면을 또 만들어야 한다.
 * 대신 구조는 데이터로 두어, 나중에 편집이 필요해지면 이 모양 그대로 테이블로
 * 옮기고 렌더러는 손대지 않는다.
 *
 * 가격, 정가, 품절, 썸네일은 여기 두지 않는다. 그 값들은 상품 DB가 가지고
 * 있어야 운영자가 직접 바꿀 수 있다.
 */
export type ConsultingSection = { title: string; body: string };

export type ConsultingCopy = {
  /** 목록 카드 가운데 한 줄 */
  cardMeta: string[];
  /** 상세 히어로의 2×2 스펙 표 */
  facts: SaleFact[];
  /**
   * 의미 단위로 끊은 헤드라인. 브라우저에 맡기면 "강의는 다 봤는데, 내 /
   * 계정에" 처럼 조사가 앞줄에 홀로 남는다. 어디서 끊을지는 원고가 정한다.
   * 좁은 화면에서는 각 줄이 다시 자연스럽게 접힌다.
   */
  headlineLines: string[];
  lead: string[];
  /**
   * 리드의 결론. 본문에 묻으면 안 읽혀서 따로 크게 뽑는다.
   * 헤드라인과 같은 이유로 줄 나눔을 원고가 정한다.
   */
  promiseLines: string[];
  needTitle: string;
  needs: string[];
  coversTitle: string;
  covers: ConsultingSection[];
  processTitle: string;
  process: SaleFact[];
  recommendTitle: string;
  recommends: string[];
  cautionTitle: string;
  cautions: string[];
  faqs: ConsultingSection[];
};

export const zoomConsulting1on1: ConsultingCopy = {
  cardMeta: ["줌 라이브 1:1", "30분", "정원 1명"],
  facts: [
    { label: "진행 방식", value: "줌(Zoom) 라이브 1:1" },
    { label: "소요 시간", value: "30분" },
    { label: "예약", value: "결제 후 설문 폼 발송" },
    { label: "연락", value: "설문 작성 후 48시간 이내" },
  ],
  headlineLines: [
    "강의는 다 봤는데,",
    "내 계정에 적용은 어떻게",
    "해야 할지 모르겠다면",
  ],
  lead: [
    "[이윰 SNS 수익화 클래스]를 완강하셔도, 막상 “그래서 내 계정은 뭐부터 고쳐야 하지?”라는 질문 앞에서 막막해지는 순간이 와요.",
    "강의에서는 원리를 알려드리지만, 여러분 계정의 프로필, 숏폼, 케러셀, 협찬 제안까지 하나하나 봐드릴 수는 없어요.",
    "그래서 준비했어요. 줌으로 진행하는 1:1 라이브 컨설팅.",
  ],
  promiseLines: [
    "여러분 계정을 직접 보면서,",
    "지금 당장 뭘 고쳐야 하는지",
    "제가 그 자리에서 짚어드려요.",
  ],
  needTitle: "이런 순간에 필요해요",
  needs: [
    "강의는 다 들었는데 내 계정에 어떻게 적용할지 막막할 때",
    "협찬 제안 DM이 왔는데 이대로 답해도 되는지 확신이 안 설 때",
    "릴스를 올렸는데 왜 반응이 없는지 스스로는 원인을 못 찾을 때",
    "프로필·랜딩페이지를 세팅했는데 이게 맞게 한 건지 확인받고 싶을 때",
    "원고료 협상 문구를 내 상황에 맞게 다시 다듬고 싶을 때",
  ],
  coversTitle: "컨설팅에서 다루는 것",
  covers: [
    {
      title: "계정 진단",
      body: "프로필, 피드 색감, 최근 릴스 성과를 함께 보면서 지금 계정의 강점과 약점을 짚어드려요.",
    },
    {
      title: "콘텐츠 방향 점검",
      body: "기존 콘텐츠는 강점과 약점을 함께 분석해요.",
    },
    {
      title: "알고리즘, 인사이트 분석",
      body: "여러분의 릴스와 피드 알고리즘 및 인사이트를 세부적으로 분석해요.",
    },
    {
      title: "후킹 함께 고치기",
      body: "수강생이 작성한 후킹을 이윰과 함께 고쳐봐요.",
    },
    {
      title: "실전 협상 코칭",
      body: "실제로 받은 협찬 제안이나 원고료 협상 문구가 있다면, 그 자리에서 같이 다듬어드려요.",
    },
    {
      title: "다음 액션 플랜",
      body: "컨설팅이 끝난 이후 “그 다음은 뭘 먼저 해야 하는지” 구체적인 우선순위 리스트를 받아가세요.",
    },
  ],
  processTitle: "진행 방식",
  process: [
    { label: "방식", value: "줌(Zoom) 라이브 1:1" },
    { label: "시간", value: "30분" },
    {
      label: "예약",
      value:
        "결제하시면 이윰이 카톡과 이메일로 설문 폼을 보내드립니다. 설문 폼을 작성하시면 48시간 이내로 제가 연락드리겠습니다.",
    },
  ],
  recommendTitle: "이런 분께 추천해요",
  recommends: [
    "이윰 클래스를 이미 수강 중이거나 완강하신 분",
    "강의 내용을 내 계정에 어떻게 적용할지 직접 확인받고 싶은 분",
    "협찬·원고료 협상을 앞두고 있어 실전 피드백이 필요한 분",
  ],
  cautionTitle: "이런 분은 신중하게 고려해주세요",
  cautions: [
    "아직 계정을 만들지 않았거나 콘텐츠를 한 번도 올려본 적 없는 분 (기초 강의부터 먼저 들으시는 걸 추천해요)",
  ],
  faqs: [
    {
      title: "강의를 안 들어도 신청할 수 있나요?",
      body: "아니오. 강의 내용을 바탕으로 계정을 함께 보는 자리라, 수강 중이거나 완강하신 분께 열려 있어요.",
    },
    {
      title: "몇 명이 함께 진행하나요?",
      body: "1:1로만 진행돼요. 다른 수강생과 함께 듣는 방식이 아니에요.",
    },
  ],
};

export const consultingCopyBySlug: Record<string, ConsultingCopy> = {
  "zoom-consulting-1on1": zoomConsulting1on1,
};
