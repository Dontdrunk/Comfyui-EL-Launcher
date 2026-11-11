import { useNavigate } from "@tanstack/react-router";

/*
 * 没有可用的 ComfyUI 便携版根目录时，所有页面共用这一屏。
 * 侧栏和标题栏留着（用户要能自己走到设置），内容区只留一句结论和一个入口，
 * 不再让每个页面各写一套「未设置目录 / 目录不存在」的提示。
 */
export function NeedSetup(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="needsetup">
      <p className="needsetup__text">请配置 ComfyUI 项目目录后使用</p>
      <button
        type="button"
        className="btn"
        onClick={() => void navigate({ to: "/settings" })}
      >
        去设置
      </button>
    </div>
  );
}
