export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RequestOtpInput {
  phoneNumber: string;
}

export interface VerifyOtpInput {
  phoneNumber: string;
  otp: string;
}

export interface CompleteOtpRegistrationInput {
  otpSessionId: string;
  name: string;
  email: string;
  phoneNumber: string;
}

export interface AuthenticatedUserDto {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
}
