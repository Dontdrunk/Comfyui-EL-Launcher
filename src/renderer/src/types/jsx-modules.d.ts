/* components/bg 下是 ReactBits 的 .jsx 组件（原样引入，未改写）。
   本项目 tsconfig 没开 allowJs，这里给个模块声明让 tsc 放行。
   没有它，import ... from './bg/X/X.jsx' 会报 TS2307。 */
declare module '*.jsx' {
  const Component: (props: Record<string, unknown>) => React.JSX.Element
  export default Component
}
