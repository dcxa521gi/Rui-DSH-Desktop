import qrcode from 'qrcode-generator'

export function qrSvgMarkup(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const svg = qr.createSvgTag(4, 1)
  return svg.replace('<svg', '<svg class="rui-qr" role="img" aria-label="微信登录二维码"')
}
