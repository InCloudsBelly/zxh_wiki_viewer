"use client";

import MarkdownContent from "@/components/MarkdownContent";

const content = String.raw`行内公式 $E=mc^2$，其中 $m$ 表示质量。

## 积分与根式

$$
\int_0^1 x^2\,\mathrm{d}x=\frac{1}{3},\qquad f(x)=\sqrt{x^2+1}
$$

## 矩阵与多行推导

$$
\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}
\begin{bmatrix}x \\ y\end{bmatrix}
=\begin{bmatrix}x \\ y\end{bmatrix}
$$

$$
\begin{aligned} f(x)&=x^2 \\ f'(x)&=2x \end{aligned}
$$

## 长公式

$$
${Array.from({ length: 30 }, (_, i) => `a_{${i + 1}}x^{${i + 1}}`).join("+")}=0
$$

## 错误公式回退

错误输入 $\frac{1}{$；后续正确公式 $x^2$ 和正文仍可阅读。

## 代码与占位符

` + "行内代码 `$literal$`、价格 \\$5 和 \\$10、占位符 <profile>示例</profile>。\n\n```latex\n\\frac{1}{2}\n```\n";

export default function MathCheck() {
  return <main style={{ maxWidth: 960, width: "100%", padding: 24, margin: "0 auto" }}>
    <h1>Wiki LaTeX rendering check</h1>
    <button type="button" onClick={() => document.documentElement.setAttribute("data-theme", "dark")}>深色验收</button>
    {" · "}
    <button type="button" onClick={() => document.documentElement.setAttribute("data-theme", "light")}>浅色验收</button>
    <MarkdownContent owner="local" repo="test" onNavigate={() => {}} slugByName={new Map()}
      page={{ path: "math.md", slug: "math", title: "Math", category: "test", frontmatter: {}, links: [], content }} />
  </main>;
}
