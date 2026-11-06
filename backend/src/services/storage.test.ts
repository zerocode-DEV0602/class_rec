import { describe, expect, it } from "vitest";
import { hasSupportedSignature } from "./storage";

describe("uploaded file signature validation", () => {
  it("recognizes a PDF signature", () => {
    expect(
      hasSupportedSignature(Buffer.from("%PDF-1.7 body"), "application/pdf"),
    ).toBe(true);
  });

  it("recognizes JPEG and PNG signatures", () => {
    expect(
      hasSupportedSignature(
        Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        "image/jpeg",
      ),
    ).toBe(true);
    expect(
      hasSupportedSignature(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        "image/png",
      ),
    ).toBe(true);
  });

  it("requires a ZIP header and Word document entry for DOCX", () => {
    expect(
      hasSupportedSignature(
        Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.from("word/document.xml"),
        ]),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      hasSupportedSignature(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });

  it("rejects mismatched and unsupported file types", () => {
    expect(
      hasSupportedSignature(Buffer.from("not a PDF"), "application/pdf"),
    ).toBe(false);
    expect(hasSupportedSignature(Buffer.from("data"), "text/plain")).toBe(
      false,
    );
  });
});
