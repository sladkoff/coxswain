// Renders resources/icon.svg to a 1024px PNG with a transparent background (qlmanage fills it white):
// swift scripts/render-icon.swift resources/icon.svg resources/icon.png
import AppKit
let a = CommandLine.arguments
guard let img = NSImage(contentsOfFile: a[1]) else { fatalError("can't read svg") }
let s = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: s, pixelsHigh: s, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
img.draw(in: NSRect(x: 0, y: 0, width: s, height: s))
NSGraphicsContext.current = nil
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
