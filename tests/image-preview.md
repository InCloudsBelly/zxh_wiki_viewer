# 图片预览浏览器回归

使用 Node.js 22+ 和已安装的 Edge/Chrome。无需安装测试依赖。

先在 Viewer 根目录启动本地开发服务：

```powershell
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 64178
```

在另一个终端运行：

```powershell
node tests/image-preview.browser.mjs http://127.0.0.1:64178/image-preview-check D:\temp\wiki-image-preview-check
```

测试临时创建独立文章路由和合成图片，结束时删除；不读取或写入真实 Wiki。测试期间不要执行生产构建。请勿并行运行多个实例。

`WIKI_TEST_BROWSER` 可指定 Chromium 浏览器可执行文件。浏览器使用独立临时配置，结果和桌面/移动端截图写入最后一个参数指定的目录。

覆盖图片、内嵌 SVG、异步 Mermaid、图片链接、加载失败、鼠标和键盘、双指缩放、横竖屏、明暗主题。移动端为 Chromium 触屏模拟；iOS Safari 和实际设备需人工验收。
