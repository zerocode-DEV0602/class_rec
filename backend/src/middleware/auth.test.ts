import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { allowRoles, sameInstitution } from "./auth";

function responseMock() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("role and institution middleware", () => {
  it("allows an explicitly permitted role", () => {
    const req = {
      user: {
        id: "faculty-1",
        role: "faculty",
        institutionId: "school-1",
        name: "Faculty",
      },
    } as unknown as Request;
    const res = responseMock();
    const next = vi.fn() as unknown as NextFunction;
    allowRoles("faculty")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("denies a role not listed for the action", () => {
    const req = {
      user: {
        id: "student-1",
        role: "student",
        institutionId: "school-1",
        name: "Student",
      },
    } as unknown as Request;
    const res = responseMock();
    const next = vi.fn() as unknown as NextFunction;
    allowRoles("faculty")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("denies requests without an authenticated user", () => {
    const req = {} as Request;
    const res = responseMock();
    const next = vi.fn() as unknown as NextFunction;
    allowRoles("administrator")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("enforces tenant isolation and allows only the Super Admin cross-tenant exception", () => {
    const res = responseMock();
    const admin = {
      user: {
        id: "admin",
        role: "administrator",
        institutionId: "school-a",
        name: "Admin",
      },
    } as unknown as Request;
    expect(sameInstitution(admin, res, "school-a")).toBe(true);
    expect(sameInstitution(admin, res, "school-b")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    const root = {
      user: { id: "root", role: "super_admin", name: "Root" },
    } as unknown as Request;
    expect(sameInstitution(root, res, "school-b")).toBe(true);
  });
});
