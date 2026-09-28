package com.retroweb.api.auth;

import lombok.Builder;
import lombok.Value;

/**
 * 认证 DTO
 */
public class AuthDtos {

    @Value
    @Builder
    public static class RegisterRequest {
        String email;
        String password;
    }

    @Value
    @Builder
    public static class LoginRequest {
        String email;
        String password;
    }

    @Value
    @Builder
    public static class TokenResponse {
        String token;
        String userId;
        String email;
    }
}
