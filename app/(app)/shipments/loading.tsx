// Скелетон ленты на время серверной загрузки getFeed (страница — серверный
// компонент с await). Тулбар виден в неактивном виде + skeleton-машины леджера.
// Разметка тулбара статична (без логики) — источник истины FeedToolbar (A5).

function Svg({
  children,
  className,
  strokeWidth = 2,
}: {
  children: React.ReactNode;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// Левая зона + строки позиций — формы реальной машины (A · Загрузка).
function SkMachine({ rows, widths }: { rows: number; widths: string[] }) {
  return (
    <div className="sk-machine">
      <div className="sk-left">
        <div className="sk-badge" />
        <div className="sk-bar" style={{ width: "60%" }} />
        <div className="sk-bar" style={{ width: "44%" }} />
      </div>
      <div className="sk-row">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="sk-pos" key={i}>
            <div className="sk-bar" style={{ width: widths[i % widths.length] }} />
            <div className="sk-bar" />
            <div className="sk-bar" style={{ width: "78%" }} />
            <div className="sk-bar" />
            <div className="sk-bar" style={{ width: "60%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Лента отгрузок</h1>
        <p className="text-sm text-muted-foreground">Овощное сырьё на завод</p>
      </div>

      <div className="toolbar">
        <div className="tbar-row">
          <button type="button" className="btn btn-primary">
            <Svg>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </Svg>
            Отгрузка
          </button>
          <div className="weeknav">
            <button type="button" disabled>
              <Svg>
                <polyline points="15 18 9 12 15 6" />
              </Svg>
            </button>
            <div className="wlabel">Загрузка…</div>
            <button type="button" disabled>
              <Svg>
                <polyline points="9 18 15 12 9 6" />
              </Svg>
            </button>
          </div>
          <button type="button" className="btn btn-sm btn-ghost">
            Сегодня
          </button>
          <div className="spacer" />
          <div className="seg">
            <button type="button" className="active">
              Лента
            </button>
            <button type="button">Сводка</button>
          </div>
        </div>
        <div className="tbar-row">
          <div className="search">
            <Svg className="ic-search">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </Svg>
            <input type="text" placeholder="Поиск: фермер, культура, № акта…" />
          </div>
          <div className="filter-wrap">
            <button type="button" className="filter">
              Поставщик
              <Svg className="fl-chev">
                <polyline points="6 9 12 15 18 9" />
              </Svg>
            </button>
          </div>
          <div className="filter-wrap">
            <button type="button" className="filter">
              Сырьё
              <Svg className="fl-chev">
                <polyline points="6 9 12 15 18 9" />
              </Svg>
            </button>
          </div>
          <div className="filter-wrap">
            <button type="button" className="filter">
              Статус: <span className="fv">все</span>
              <Svg className="fl-chev">
                <polyline points="6 9 12 15 18 9" />
              </Svg>
            </button>
          </div>
          <div className="spacer" />
          <label className="toggle">
            <span className="switch off" />
            Скрыть плановые
          </label>
          <button type="button" className="btn btn-sm is-disabled" aria-disabled>
            <Svg>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </Svg>
            Excel
          </button>
        </div>
      </div>

      <div className="feedzone">
        <div className="sk-stack">
          <SkMachine rows={2} widths={["70%", "55%"]} />
          <SkMachine rows={3} widths={["64%", "58%", "50%"]} />
          <SkMachine rows={1} widths={["66%"]} />
        </div>
      </div>
    </div>
  );
}
