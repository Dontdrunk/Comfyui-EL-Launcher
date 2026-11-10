import { PageLoading } from "#src/launcher/components/ui.tsx";

/*
 * 路由模块加载中的占位。和页面自己的首屏加载态用同一个居中转圈：
 * 模块就绪后转圈留在原地，只换成页面自己的文案，不会从顶部跳到中间。
 */
export const Loader = () => <PageLoading label="加载中…" />;
