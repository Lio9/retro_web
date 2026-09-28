package com.retroweb.api.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/**
 * 认证接口：POST /api/auth/register | /login
 */
@RestController
@RequestMapping("/api/auth")
@Validated
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    public record RegisterBody(
            @Email @NotBlank String email,
            @NotBlank @Size(min = 8, max = 72) String password
    ) {}

    public record LoginBody(
            @Email @NotBlank String email,
            @NotBlank String password
    ) {}

    @PostMapping("/register")
    public AuthDtos.TokenResponse register(@Valid @RequestBody RegisterBody body) {
        return authService.register(AuthDtos.RegisterRequest.builder()
                .email(body.email())
                .password(body.password())
                .build());
    }

    @PostMapping("/login")
    public AuthDtos.TokenResponse login(@Valid @RequestBody LoginBody body) {
        return authService.login(AuthDtos.LoginRequest.builder()
                .email(body.email())
                .password(body.password())
                .build());
    }
}
