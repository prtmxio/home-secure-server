export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthenticatedUserDto {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}
