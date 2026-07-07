import LandingInteractions from "@/components/LandingInteractions";
import ReviewMarquee from "@/components/ReviewMarquee";

export default function Home() {
  return (
    <>
      <span id="top" />

      {/* ===== NAV ===== */}
      <nav id="nav" style={{position: 'fixed', top: '0', left: '0', right: '0', zIndex: '60', color: '#201C17', transition: 'background 0.4s ease,color 0.4s ease,border-color 0.4s ease', borderBottom: '1px solid transparent'}}>
        <div style={{maxWidth: '1200px', margin: '0 auto', padding: '20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <a href="#top" className="serif" style={{fontSize: '23px', letterSpacing: '0.01em'}}>이윰</a>
          <div style={{display: 'flex', alignItems: 'center', gap: '34px', fontSize: '14px', fontWeight: '500'}}>
            <a href="#curriculum" className="ulink">강의</a>
            <a href="#apply" className="ulink">전자책</a>
            <a href="#reviews" className="ulink">후기</a>
            <a href="/sns" className="ulink">SNS</a>
            <a href="#apply" style={{padding: '9px 20px', border: '1px solid currentColor', borderRadius: '100px', fontWeight: '600'}}>수강 신청</a>
          </div>
        </div>
      </nav>

      {/* ===== HERO ===== */}
      <header id="hero" style={{position: 'relative', background: '#F3EFE8', color: '#201C17', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '140px 40px 90px', overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden'}}><div style={{position: 'absolute', top: '-8%', left: '50%', transform: 'translateX(-50%)', width: '76vw', height: '66vh', background: 'radial-gradient(58% 58% at 50% 32%,rgba(217,130,94,0.18),rgba(217,130,94,0) 70%)', filter: 'blur(8px)'}}></div></div>
        <div style={{position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden'}}><div className="serif" style={{fontSize: '34vw', lineHeight: '1', letterSpacing: '-0.04em', color: 'rgba(32,28,23,0.045)', whiteSpace: 'nowrap', animation: 'wmDrift 26s ease-in-out infinite'}}>yiyum</div></div>
        <div style={{position: 'relative', zIndex: '1', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          <div style={{overflow: 'hidden', marginBottom: '22px'}}><div style={{animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.1s both', fontSize: '17px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#B85C38', fontWeight: '600'}}>이윰 SNS 수익화 클래스</div></div>

          <h1 className="serif" style={{fontSize: 'clamp(40px,7vw,88px)', lineHeight: '1.12', letterSpacing: '-0.01em', margin: '0', maxWidth: '14ch'}}>
            <span style={{display: 'block', overflow: 'hidden', paddingBottom: '6px'}}><span style={{display: 'block', animation: 'rise 1s cubic-bezier(0.16,1,0.3,1) 0.25s both'}}>차이는 팔로워</span></span>
            <span style={{display: 'block', overflow: 'hidden', paddingBottom: '6px'}}><span style={{display: 'block', animation: 'rise 1s cubic-bezier(0.16,1,0.3,1) 0.4s both'}}>수가 <span style={{color: '#B85C38'}}>아닙니다</span></span></span>
          </h1>

          <div className="hero-stats" style={{display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: '44px', marginTop: '52px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 0.85s both'}}>
            <div style={{width: '190px', textAlign: 'right'}}>
              <div style={{fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A79F92', marginBottom: '10px'}}>흔한 착각</div>
              <div style={{fontSize: '16px', lineHeight: '1.55', color: '#938B7F'}}>팔로워 <span className="serif" style={{fontSize: '22px', color: '#57514A'}}>5만</span>인데{" "}<br className="bk" />수익화 실패</div>
            </div>
            <div style={{width: '1px', background: '#DDD5C8'}}></div>
            <div style={{width: '190px', textAlign: 'left'}}>
              <div style={{fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#B85C38', marginBottom: '10px'}}>이윰의 방식</div>
              <div style={{fontSize: '16px', lineHeight: '1.55', color: '#2E2820'}}>팔로워 <span className="serif" style={{fontSize: '22px', color: '#B85C38'}}>300</span>부터 협찬,{" "}<br className="bk" /><span className="serif" style={{fontSize: '22px', color: '#B85C38'}}>1,000</span>대부터 수익화</div>
            </div>
          </div>

          <p style={{fontSize: '18px', lineHeight: '1.85', color: '#57514A', margin: '46px auto 0', maxWidth: '520px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 1s both'}}>"일단 팔로워부터 늘려." 다들 이렇게 말하지만, 반대입니다.{" "}<br className="bk" />처음부터 <span style={{color: '#201C17', fontWeight: '600'}}>팔로워가 수익으로 연결되는 구조</span>로 설계해야 해요.</p>

          <div style={{marginTop: '44px', animation: 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) 1.15s both'}}>
            <a href="#apply" style={{display: 'inline-flex', alignItems: 'center', gap: '12px', padding: '16px 32px', background: '#B85C38', color: '#F6F1E9', borderRadius: '100px', fontSize: '16px', fontWeight: '600', transition: 'transform 0.3s ease,box-shadow 0.3s ease', boxShadow: '0 8px 24px rgba(184,92,56,0.24)'}} className="cta-lift">32강 커리큘럼 보기<span style={{fontSize: '18px'}}>→</span></a>
          </div>
        </div>
        <div style={{position: 'absolute', bottom: '34px', left: '0', right: '0', textAlign: 'center', fontSize: '11px', letterSpacing: '0.28em', textTransform: 'uppercase', color: '#A79F92', animation: 'fadeUp 1s ease 1.5s both'}}>Scroll</div>
      </header>

      {/* ===== 01 ABOUT ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>01</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>About</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 64px', maxWidth: '18ch'}}>작은 계정이 수익이 되기까지</h2>

        <div style={{display: 'grid', gridTemplateColumns: '1fr 0.82fr', gap: '72px', alignItems: 'stretch'}}>
          <div data-reveal="">
            <p className="serif" style={{fontSize: 'clamp(21px,2.4vw,27px)', lineHeight: '1.65', letterSpacing: '-0.01em', margin: '0 0 32px', color: '#201C17'}}>안녕하세요, 리빙 크리에이터 <span style={{color: '#B85C38'}}>이윰</span>입니다.{" "}<br className="bk" />리빙 인스타그램을 시작한 지 3주 만에 팔로워 1,000명,{" "}<br className="bk" />12주 만에 1만 명을 넘겼어요.{" "}<br className="bk" />그리고 지금은 <span style={{color: '#B85C38'}}>100명이 넘는 수강생</span> 분과 함께 성장하고 있습니다.</p>
            <p style={{fontSize: '16.5px', lineHeight: '1.95', color: '#57514A', margin: '0 0 22px'}}>많은 분들이 '팔로워가 몇 만은 돼야 협찬이 들어온다'고 생각해요.{" "}<br className="bk" />하지만 저는 팔로워 1,000명대부터 가구 협찬(소파·식탁·거울·선반)과{" "}<br className="bk" />가전 협찬(식세기·냉장고·음쓰처리기)을 받았고,{" "}<br className="bk" />2,000명대부터는 원고료가 붙는 유가 광고를 받았습니다.</p>
            <p style={{fontSize: '16.5px', lineHeight: '1.95', color: '#57514A', margin: '0 0 40px'}}>비결은 팔로워를 먼저 모으고 수익화를 나중에 고민한 게 아니라,{" "}<br className="bk" />처음부터 <span style={{color: '#201C17', fontWeight: '600'}}>팔로워가 수익으로 연결되는 구조</span>로 계정을 설계했다는 것.{" "}<br className="bk" />그 차이를 이 강의에 전부 담았어요.</p>
            <p style={{fontSize: '16.5px', lineHeight: '1.95', color: '#57514A', margin: '0'}}>진짜 차이는 계정을 설계하는 단계에서부터 수익 모델까지 함께 그렸는가에 있어요. 콘텐츠 하나를 올릴 때도, 팔로워 한 명이 늘 때도,{" "}<br className="bk" />그게 어디로 연결되는지 이미 정해져 있었어요.{" "}<br className="bk" />이 플로우만 알면 작은 계정으로도 수익화 가능해요.{" "}<br className="bk" /><span style={{color: '#201C17', fontWeight: '600'}}>팔로워가 수익으로 연결되는 구조를 계정에 심어두는 방법을 가르쳐드려요.</span></p>
          </div>
          <figure data-reveal="" data-reveal-delay="120" className="about-figure" style={{margin: '0'}}>
            <div className="about-imgwrap" style={{overflow: 'hidden', borderRadius: '8px'}}><img src="/assets/profile.jpg" loading="lazy" alt="리빙 크리에이터 이윰" className="about-img" style={{width: '100%', objectFit: 'cover', display: 'block'}} /></div>          </figure>
        </div>

        {/* growth */}
        <div data-reveal="" className="stat-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0', margin: '96px 0 0', borderTop: '1px solid #DDD5C8'}}>
          <div style={{padding: '32px 28px 32px 0', borderRight: '1px solid #DDD5C8'}}>
            <div style={{fontSize: '13px', letterSpacing: '0.06em', color: '#938B7F', marginBottom: '14px'}}>3주 만에</div>
            <div className="serif" style={{fontSize: '46px', lineHeight: '1', color: '#201C17'}}>1,000</div>
            <div style={{fontSize: '14px', color: '#938B7F', marginTop: '8px'}}>팔로워</div>
          </div>
          <div style={{padding: '32px 28px', borderRight: '1px solid #DDD5C8'}}>
            <div style={{fontSize: '13px', letterSpacing: '0.06em', color: '#938B7F', marginBottom: '14px'}}>7주차</div>
            <div className="serif" style={{fontSize: '46px', lineHeight: '1', color: '#201C17'}}>5,000</div>
            <div style={{fontSize: '14px', color: '#938B7F', marginTop: '8px'}}>팔로워</div>
          </div>
          <div style={{padding: '32px 0 32px 28px'}}>
            <div style={{fontSize: '13px', letterSpacing: '0.06em', color: '#B85C38', marginBottom: '14px'}}>12주차</div>
            <div className="serif" style={{fontSize: '46px', lineHeight: '1', color: '#B85C38'}}>10,000</div>
            <div style={{fontSize: '14px', color: '#938B7F', marginTop: '8px'}}>팔로워 달성</div>
          </div>
        </div>

        {/* 협찬 로드맵 */}
        <div style={{marginTop: '110px'}}>
          <div data-reveal="" style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#B85C38', fontWeight: '600', marginBottom: '16px'}}>실제 사례</div>
          <h3 data-reveal="" className="serif" style={{fontSize: 'clamp(26px,3.4vw,38px)', letterSpacing: '-0.01em', margin: '0 0 8px'}}>팔로워 구간별 협찬 로드맵</h3>
          <p data-reveal="" style={{fontSize: '16px', color: '#938B7F', margin: '0 0 40px'}}>작은 계정에도 이미 이런 제안들이 들어왔습니다.</p>

          <div style={{borderTop: '1px solid #201C17'}}>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>500<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>디퓨저 · 주방세제 · 얼룩제거제 · 수건 등 <span style={{color: '#B85C38'}}>무가 협찬</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>1,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>소파 · 식탁 · 거울 · 러그 · 모듈 선반 등 <span style={{color: '#B85C38'}}>가구 협찬이 하루 3~5건</span></span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>2,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>릴스 1개당 <span style={{color: '#B85C38'}}>원고료 5만~50만원</span> (평균 10~20만원) 유가 광고</span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #DDD5C8', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>3,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>치트키 5가지로 원고료 <span style={{color: '#B85C38'}}>10만 → 20만 → 50만 → 100만원</span> 상승</span>
            </div>
            <div data-reveal="" style={{display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', padding: '26px 4px', borderBottom: '1px solid #201C17', alignItems: 'baseline'}}>
              <span className="serif" style={{fontSize: '26px', color: '#201C17'}}>4,000<span style={{fontSize: '16px', color: '#938B7F'}}> 명대</span></span>
              <span style={{fontSize: '16px', lineHeight: '1.6', color: '#4E483F'}}>역제안 템플릿으로 10만원 제안을 <span style={{color: '#B85C38'}}>100만원으로 협상</span> · 식세기 · 냉장고 등 굵직한 가전</span>
            </div>
          </div>
          <div data-reveal="" className="road-callout">
            <span className="road-callout-label">결론</span>
            <p className="road-callout-text">제 수강생들도 <span style={{color: '#E9B48E'}}>200~300명</span>의 적은 팔로워로 협찬과 원고료를 받았어요.{" "}<br className="bk" />비결은 처음부터 <span style={{color: '#ffffff', fontWeight: '600'}}>광고주가 원하는 계정으로 설계</span>하는 것!{" "}<br className="bk" />계정을 설계하는 단계에서부터 수익 모델까지 그리는 법만 알면{" "}<br className="bk" />저와 제 수강생처럼 <span style={{color: '#E9B48E'}}>작은 계정으로도 수익화 가능</span>해요.</p>
          </div>
        </div>
      </section>

      {/* ===== 02 WHO ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>02</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>For You?</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 64px', maxWidth: '18ch'}}>이 강의, 누구를 위한 걸까요</h2>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px'}}>
          <div data-reveal="">
            <div style={{fontSize: '14px', fontWeight: '700', letterSpacing: '0.04em', color: '#B85C38', marginBottom: '26px'}}>이런 분들께 권합니다</div>
            <ul style={{listStyle: 'none', padding: '0', margin: '0', display: 'flex', flexDirection: 'column'}}>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#2E2820', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span className="serif" style={{color: '#B85C38', flexShrink: '0'}}>01</span> 팔로워가 적어 협찬·수익화는 아직 멀었다고 생각하는 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#2E2820', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span className="serif" style={{color: '#B85C38', flexShrink: '0'}}>02</span> 계정은 있는데 방향을 못 잡아 막막한 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#2E2820', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span className="serif" style={{color: '#B85C38', flexShrink: '0'}}>03</span> 늘 무가·저단가 제안만 오는 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#2E2820', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span className="serif" style={{color: '#B85C38', flexShrink: '0'}}>04</span> 브랜드 답장을 몰라 좋은 제안을 놓치는 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#2E2820', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span className="serif" style={{color: '#B85C38', flexShrink: '0'}}>05</span> 숫자로 증명된 실행 가능한 노하우를 원하는 분</li>
            </ul>
          </div>
          <div data-reveal="" data-reveal-delay="120">
            <div style={{fontSize: '14px', fontWeight: '700', letterSpacing: '0.04em', color: '#938B7F', marginBottom: '26px'}}>이런 분들껜 맞지 않아요</div>
            <ul style={{listStyle: 'none', padding: '0', margin: '0', display: 'flex', flexDirection: 'column'}}>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#938B7F', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span style={{flexShrink: '0'}}>—</span> 이미 원고료 협상을 능숙하게 하는 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#938B7F', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span style={{flexShrink: '0'}}>—</span> 팔로워 규모와 무관하게 이미 안정적으로 수익화 중인 분</li>
              <li style={{display: 'flex', gap: '16px', fontSize: '16px', lineHeight: '1.55', color: '#938B7F', padding: '18px 0', borderTop: '1px solid #E4DDD1'}}><span style={{flexShrink: '0'}}>—</span> 팔로워 폭증만 원하고 수익화엔 관심 없는 분</li>
            </ul>
          </div>
        </div>
      </section>

      {/* anchor:curriculum */}
      <span id="curriculum"></span>
      {/* ===== 03 CURRICULUM ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px', flexWrap: 'wrap', gap: '16px'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: '20px'}}>
            <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>03</span>
            <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>Curriculum</span>
          </div>
          <div style={{fontSize: '14px', color: '#57514A'}}>5개 챕터 · 총 <span className="serif" style={{fontSize: '20px', color: '#201C17'}}>32</span>강</div>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 56px', maxWidth: '18ch'}}>계정 세팅부터 세금까지, 수익화의 처음과 끝</h2>

        <div style={{borderTop: '1px solid #201C17'}}>

          <details open style={{borderBottom: '1px solid #DDD5C8'}}>
            <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
              <span className="serif" style={{fontSize: '30px', color: '#B85C38', flexShrink: '0', width: '44px'}}>01</span>
              <span style={{flex: '1'}}><span style={{fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#938B7F', display: 'block', marginBottom: '4px'}}>Chapter · 6강</span><span style={{fontSize: '22px', fontWeight: '600'}}>계정 세팅</span></span>
              <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
            </summary>
            <div className="cbody" style={{padding: '0 4px 30px 68px'}}>
              <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>01</span> 크리에이터 카테고리 정복하기 — 진입장벽·시청자층·얼굴 노출</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>02</span> 계정 정체성 잡는 법 — 한 계정에 여러 주제 올려도 되나요?</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>03</span> 수익화를 위한 프로필 4줄 세팅법</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>04</span> 수익화 필수 랜딩페이지 만드는 법 · 올바른 사용법</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>05</span> 계정 날아가지 않게 취해야 하는 조치 6가지</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>06</span> SNS에서 마음껏 활동하려면 무조건 해야 하는 것</li>
              </ol>
            </div>
          </details>

          <details style={{borderBottom: '1px solid #DDD5C8'}}>
            <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
              <span className="serif" style={{fontSize: '30px', color: '#B85C38', flexShrink: '0', width: '44px'}}>02</span>
              <span style={{flex: '1'}}><span style={{fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#938B7F', display: 'block', marginBottom: '4px'}}>Chapter · 4강</span><span style={{fontSize: '22px', fontWeight: '600'}}>콘텐츠 제작 기본기</span></span>
              <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
            </summary>
            <div className="cbody" style={{padding: '0 4px 30px 68px'}}>
              <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>07</span> 숏폼 &amp; 릴스 트렌드 분석</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>08</span> 촬영 전 기본 세팅값 — 카메라 화질, 촬영 비율</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>09</span> 촬영 장비 소개 — 삼각대, 마이크</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>10</span> 편집 프로그램 — 자막·효과음·목소리 넣는 법</li>
              </ol>
            </div>
          </details>

          <details style={{borderBottom: '1px solid #DDD5C8'}}>
            <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
              <span className="serif" style={{fontSize: '30px', color: '#B85C38', flexShrink: '0', width: '44px'}}>03</span>
              <span style={{flex: '1'}}><span style={{fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#938B7F', display: 'block', marginBottom: '4px'}}>Chapter · 10강</span><span style={{fontSize: '22px', fontWeight: '600'}}>알고리즘</span></span>
              <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
            </summary>
            <div className="cbody" style={{padding: '0 4px 30px 68px'}}>
              <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>11</span> 알고리즘 타는 릴스의 비밀</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>12</span> 카테고리별 내적 욕망 자극하는 법</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>13</span> 떡상하는 릴스의 공통점</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>14</span> 빠르게 팔로워 늘리는 법</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>15</span> 알고리즘 부스터 켜는 사후 전략 7개</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>16</span> 초반 3초 후킹 생각하는 팁</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>17</span> 해시태그, 이렇게 쓰면 10년 뒤처진 겁니다</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>18</span> 콘텐츠 소재 무한대로 얻는 법</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>19</span> 광고 릴스 대본 써주는 최적화 프롬프트</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>20</span> 댓글 품앗이, 이렇게 하면 계정 나락 갑니다</li>
              </ol>
            </div>
          </details>

          <details style={{borderBottom: '1px solid #DDD5C8'}}>
            <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
              <span className="serif" style={{fontSize: '30px', color: '#B85C38', flexShrink: '0', width: '44px'}}>04</span>
              <span style={{flex: '1'}}><span style={{fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#938B7F', display: 'block', marginBottom: '4px'}}>Chapter · 8강</span><span style={{fontSize: '22px', fontWeight: '600'}}>수익화 로드맵</span></span>
              <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
            </summary>
            <div className="cbody" style={{padding: '0 4px 30px 68px'}}>
              <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>21</span> 수익화할 수 있는 10가지 루트</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>22</span> 팔로워 수 상관없이 100% 수익화 가능한 방법 (100명대도 가능)</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>23</span> 구간별 협찬 로드맵 — 팔로워 몇 명부터 협찬이 들어올까?</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>24</span> 단가 협상 실전편 — 원고료 얼마 받을 수 있을까?</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>25</span> 광고 단가 10배 올리는 치트키 5가지</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>26</span> 브랜드가 무조건 답장하는 이메일·DM 템플릿</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>27</span> 체험단 사이트</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>28</span> 협찬 받는 루트</li>
              </ol>
            </div>
          </details>

          <details style={{borderBottom: '1px solid #201C17'}}>
            <summary style={{display: 'flex', alignItems: 'center', gap: '24px', padding: '28px 4px'}}>
              <span className="serif" style={{fontSize: '30px', color: '#B85C38', flexShrink: '0', width: '44px'}}>05</span>
              <span style={{flex: '1'}}><span style={{fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#938B7F', display: 'block', marginBottom: '4px'}}>Chapter · 4강</span><span style={{fontSize: '22px', fontWeight: '600'}}>찐팬 · 브랜딩</span></span>
              <span className="chev" style={{fontSize: '22px', color: '#B85C38', fontWeight: '300'}}>+</span>
            </summary>
            <div className="cbody" style={{padding: '0 4px 30px 68px'}}>
              <ol style={{listStyle: 'none', padding: '0', margin: '0'}}>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>29</span> 정보성으로 모은 팔로워를 찐팬으로 전환시키는 테크트리</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>30</span> 얼굴 공개 없이 수익화 잘하는 크리에이터의 공통점</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>31</span> 세금 관리 · 세무사 추천</li>
                <li style={{display: 'flex', gap: '16px', padding: '12px 0', fontSize: '15px', color: '#4E483F', lineHeight: '1.5'}}><span style={{color: '#B49F8C', flexShrink: '0', fontSize: '13px'}}>32</span> 멘탈 관리</li>
              </ol>
            </div>
          </details>

        </div>
      </section>

      {/* ===== 04 RESULTS ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '40px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>04</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>Results</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(28px,3.6vw,42px)', letterSpacing: '-0.01em', margin: '0 0 8px', maxWidth: '16ch'}}>수강생들의 실제 수익화 인증</h2>
        <p data-reveal="" style={{fontSize: '16px', color: '#938B7F', margin: '0 0 48px'}}>작은 계정으로 협찬과 원고료를 받아낸 진짜 기록입니다.</p>
        <ReviewMarquee alt="수강생 수익화 인증" images={["/assets/proof/proof-01.jpg", "/assets/proof/proof-02.jpg", "/assets/proof/proof-03.jpg", "/assets/proof/proof-04.jpg", "/assets/proof/proof-05.jpg", "/assets/proof/proof-06.jpg", "/assets/proof/proof-07.jpg", "/assets/proof/proof-08.jpg", "/assets/proof/proof-09.jpg", "/assets/proof/proof-10.jpg", "/assets/proof/proof-11.jpg"]} />
      </section>

      {/* ===== 05 REVIEWS ===== */}
      <span id="reviews"></span>
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '130px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '40px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>05</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>Reviews</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(28px,3.6vw,42px)', letterSpacing: '-0.01em', margin: '0 0 8px', maxWidth: '16ch'}}>수강생들의 강의 후기</h2>
        <p data-reveal="" style={{fontSize: '16px', color: '#938B7F', margin: '0 0 48px'}}>오픈카톡방에서의 1:1 밀착 피드백이 가장 큰 메리트예요.</p>
        <ReviewMarquee alt="수강생 강의 후기" images={["/assets/reviews/review-01.jpg", "/assets/reviews/review-02.jpg", "/assets/reviews/review-03.jpg", "/assets/reviews/review-04.jpg", "/assets/reviews/review-05.jpg", "/assets/reviews/review-06.jpg", "/assets/reviews/review-07.jpg", "/assets/reviews/review-08.jpg", "/assets/reviews/review-09.jpg", "/assets/reviews/review-10.jpg", "/assets/reviews/review-11.jpg", "/assets/reviews/review-12.jpg", "/assets/reviews/review-13.jpg"]} />
      </section>

      {/* ===== 06 FAQ ===== */}
      <section style={{maxWidth: '1200px', margin: '0 auto', padding: '150px 40px 0'}}>
        <div data-reveal="" style={{display: 'flex', alignItems: 'baseline', gap: '20px', borderTop: '1px solid #DDD5C8', paddingTop: '24px', marginBottom: '34px'}}>
          <span className="serif" style={{fontSize: '15px', color: '#B85C38'}}>06</span>
          <span style={{fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#938B7F', fontWeight: '600'}}>FAQ</span>
        </div>
        <h2 data-reveal="" className="serif" style={{fontSize: 'clamp(30px,4vw,50px)', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 56px'}}>자주 묻는 질문</h2>
        <div style={{borderTop: '1px solid #201C17'}}>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>팔로워가 아예 없는 완전 왕초보인데 괜찮을까요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, Chapter 1(계정 세팅)부터 시작하기 때문에 팔로워 0명이신 분도 그대로 따라오시면 돼요. 초반부터 함께하면 수익화 구조를 심는 게 오히려 더 쉬워요. 다만 SNS와 동영상 편집 툴이 처음이시라면 기능을 익혀야 하니 개인마다 속도 차이는 있을 수 있어요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>리빙 계정이 아니어도 들을 수 있나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, 사례는 리빙 계정 기준으로 설명하지만, 계정 설계와 수익화 구조의 원리는 카테고리 무관하게 동일해요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>이미 운영 중인 계정이 있는데, 새로 계정을 파야 하나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>꼭 새 계정을 만들 필요는 없어요. 기존 계정을 유지하면서 방향성과 수익화 구조만 재정비할지, 새 계정으로 다시 시작할지는 계정 상태에 따라 달라지는데, 이걸 판단하는 기준과 방법을 1강·2강에서 자세히 다뤄요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>얼굴 노출 안 해도 수익화 가능한가요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>네, 29강에서 얼굴 공개 없이 수익화하는 크리에이터들의 공통점을 따로 다뤄요. 얼굴 공개가 부담스러운 분들도 걱정 안 하셔도 돼요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>랜딩페이지는 직접 만들어주시나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>직접 제작해드리는 건 아니고, 4강에서 어떤 랜딩페이지가 필요한지와 만드는 방법을 알려드려요. 팔로워는 많은데 수익화가 안 되는 계정 대부분이 이게 빠져 있어요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>원고료를 실제로 얼마나 받을 수 있나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>계정 상황에 따라 다르지만, 제 경우 2000명대에서 5~50만원, 3000명대부터는 치트키로 최대 100만원까지 단가를 올렸어요. 특정 금액을 보장드릴 수는 없지만, 실제로 밟았던 단계와 방법을 그대로 알려드려요.</div></details>
          <details style={{borderBottom: '1px solid #DDD5C8'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>강의만 들으면 바로 협찬이 들어오나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>아니요. 계정 세팅과 대응 방식을 바꾸는 데는 시간이 필요해요. 다만 제가 실제로 계정을 키우며 수익화 하는 과정을 압축해서 알려드리기 때문에 시행착오는 크게 줄일 수 있어요.</div></details>
          <details style={{borderBottom: '1px solid #201C17'}}><summary style={{display: 'flex', gap: '20px', alignItems: 'center', padding: '24px 4px'}}><span style={{flex: '1', fontSize: '17px', fontWeight: '600'}}>협찬·광고 수익 세금 처리는 어떻게 하나요?</span><span className="chev" style={{fontSize: '20px', color: '#B85C38', fontWeight: '300'}}>+</span></summary><div className="cbody" style={{padding: '0 4px 24px 4px', fontSize: '15px', color: '#57514A', lineHeight: '1.8'}}>세금 관리 기본과 세무사 추천까지 다뤄요. 수익화 이후 가장 놓치기 쉬운 부분이라, 미리 안 챙기면 나중에 세금 폭탄을 맞을 수 있어요. 그래서 강의에서 꼭 짚어드려요.</div></details>
        </div>
      </section>

      {/* ===== 07 APPLY ===== */}
      <section id="apply" style={{background: '#1B1815', color: '#EDE7DC', marginTop: '150px', padding: '130px 40px', scrollMarginTop: '0'}}>
        <div data-reveal="" style={{maxWidth: '820px', margin: '0 auto', textAlign: 'center'}}>
          <div style={{fontSize: '13px', letterSpacing: '0.28em', textTransform: 'uppercase', color: '#B7A995', marginBottom: '28px'}}>Enroll</div>
          <h2 className="serif" style={{fontSize: 'clamp(32px,4.6vw,56px)', lineHeight: '1.2', letterSpacing: '-0.01em', margin: '0 0 20px'}}>이윰 SNS 수익화 클래스</h2>
          <p style={{fontSize: '16px', color: '#9A9082', margin: '0 0 56px'}}>5개 챕터 · 총 32강 · 오픈카톡방 1:1 피드백 포함 · 365일 VOD 소장</p>
          <div style={{display: 'inline-flex', alignItems: 'baseline', gap: '10px', paddingBottom: '30px'}}>
            <span className="serif" style={{fontSize: 'clamp(56px,9vw,96px)', lineHeight: '1', color: '#EDE7DC'}}>300,000</span>
            <span className="serif" style={{fontSize: '32px', color: '#D9825E'}}>원</span>
          </div>
          <div style={{fontSize: '13px', color: '#7C7367', letterSpacing: '0.04em', marginBottom: '44px'}}>부가세 포함</div>
          <a href="#apply" style={{display: 'inline-flex', alignItems: 'center', gap: '12px', padding: '18px 46px', background: '#D9825E', color: '#1B1815', borderRadius: '100px', fontSize: '17px', fontWeight: '600', transition: 'transform 0.3s ease'}} className="cta-lift">지금 수강 신청하기<span style={{fontSize: '18px'}}>→</span></a>
          <p style={{fontSize: '13px', color: '#7C7367', lineHeight: '1.7', margin: '36px auto 0', maxWidth: '400px'}}>추후 1:1 밀착 피드백 등 프리미엄 옵션이 별도 상품으로 추가될 예정입니다.</p>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer style={{maxWidth: '1200px', margin: '0 auto', padding: '56px 40px 80px'}}>
        <div style={{display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '20px'}}>
          <span className="serif" style={{fontSize: '20px'}}>이윰 SNS 수익화 클래스</span>
          <span style={{fontSize: '13px', color: '#938B7F'}}>신혼부부 · 살림 · 리빙 SNS 수익화</span>
        </div>
        <p style={{fontSize: '12px', color: '#A79F92', lineHeight: '1.9', margin: '0', maxWidth: '820px'}}>히너스랩 · 대표 지예솔 · 사업자등록번호 866-03-03562 · 통신판매업 신고번호 [신고 후 기재 예정]<br />경기도 화성시 효행로 1068, 603-J65호(병점동, 리더스프라자) · 070-7954-9050 · yiyum.home@gmail.com<br />업무시간 평일 10:00–17:00 (점심 12–13시), 주말·공휴일 제외</p>
      </footer>

      {/* sticky buy bar */}
      <div id="buyBar" style={{position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '70', background: 'rgba(27,24,21,0.94)', backdropFilter: 'blur(12px)', color: '#EDE7DC', transform: 'translateY(130%)', transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)'}}>
        <div style={{maxWidth: '1200px', margin: '0 auto', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px'}}>
          <div style={{display: 'flex', alignItems: 'baseline', gap: '14px', minWidth: '0'}}>
            <span style={{fontSize: '14px', color: '#9A9082', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>이윰 SNS 수익화 클래스 · 32강</span>
            <span className="serif" style={{fontSize: '24px', color: '#EDE7DC', whiteSpace: 'nowrap'}}>300,000<span style={{fontSize: '15px', color: '#D9825E'}}> 원</span></span>
          </div>
          <a href="#apply" style={{padding: '12px 30px', background: '#D9825E', color: '#1B1815', borderRadius: '100px', fontSize: '15px', fontWeight: '600', whiteSpace: 'nowrap'}}>수강 신청</a>
        </div>
      </div>

      <LandingInteractions />
    </>
  );
}
