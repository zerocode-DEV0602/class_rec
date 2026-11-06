export type ClassTrackRole =
  | "super_admin"
  | "administrator"
  | "faculty"
  | "student";
export type ClassTrackUser = {
  id: string;
  name: string;
  email: string;
  role: ClassTrackRole;
  institutionId?: string;
  departmentId?: string;
  programId?: string;
  sectionId?: string;
  studentNumber?: string;
};
export type AuthSession = {
  user: ClassTrackUser;
  accessToken: string;
  refreshToken: string;
};
