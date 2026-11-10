import { Link, useRouterState } from "@tanstack/react-router";
import { Database, Home, Package, Plug, Settings, Tag, Terminal } from "lucide";

import { Icon } from "./Icon";
import type { IconNode } from "./Icon";

/* ══════════════════════════════════════════════════════════
 * 侧边栏 —— 对应原版 pages/index.html 的 el-aside(width=85px)
 *
 * 上组：业务页面（首页 / 版本 / 插件 / 模型 / 环境管理）
 * 下组 ul.szqu：控制台 / 设置，绝对定位吸底
 * 每项 65×65、圆角 12px、图标 22px 在上、13px 文案在下。
 *
 * 每项就是一个真实路由：地址栏、前进后退、托盘跳转共用同一套状态，
 * 不再有「store 里记一个 page」的第二份真相。
 * ══════════════════════════════════════════════════════════ */

interface NavEntry {
  to:
    | "/"
    | "/dashboard"
    | "/versions"
    | "/nodes"
    | "/models"
    | "/packages"
    | "/logs"
    | "/settings";
  id: string;
  label: string;
  icon: IconNode;
}

const TOP: NavEntry[] = [
  { to: "/dashboard", id: "dashboard", label: "首页", icon: Home },
  { to: "/versions", id: "versions", label: "版本管理", icon: Tag },
  { to: "/nodes", id: "nodes", label: "插件管理", icon: Plug },
  { to: "/models", id: "models", label: "模型管理", icon: Database },
  { to: "/packages", id: "packages", label: "环境管理", icon: Package },
];

const BOTTOM: NavEntry[] = [
  { to: "/logs", id: "logs", label: "控制台", icon: Terminal },
  { to: "/settings", id: "settings", label: "设置", icon: Settings },
];

function Item({
  entry,
  active,
}: {
  entry: NavEntry;
  active: boolean;
}): React.JSX.Element {
  return (
    <Link
      to={entry.to}
      className={`navitem${active ? " navitem--active" : ""}`}
      data-href={entry.id}
      aria-current={active ? "page" : undefined}
    >
      <Icon icon={entry.icon} size={22} />
      <span>{entry.label}</span>
    </Link>
  );
}

export function Sidebar(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = (entry: NavEntry): boolean => pathname === entry.to;

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        <ul className="sidebar__group">
          {TOP.map((e) => (
            <li key={e.id} style={{ display: "contents" }}>
              <Item entry={e} active={active(e)} />
            </li>
          ))}
        </ul>

        <ul className="sidebar__group sidebar__group--bottom">
          {BOTTOM.map((e) => (
            <li key={e.id} style={{ display: "contents" }}>
              <Item entry={e} active={active(e)} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
