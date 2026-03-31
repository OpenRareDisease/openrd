export interface OtpSendResult {
  provider: string;
  requestId: string;
  sentTo: string;
  mockCode?: string;
}

export interface OtpProvider {
  sendCode(input: {
    phoneNumber: string;
    code: string;
    ttlMinutes: number;
    requestId: string;
  }): Promise<OtpSendResult>;
}
