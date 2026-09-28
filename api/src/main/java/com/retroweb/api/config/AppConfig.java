package com.retroweb.api.config;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

/**
 * JWT 与通用配置
 */
@Configuration
public class AppConfig {

    @Value("${app.jwt.secret:change-me-please-use-32-bytes-min-secret}")
    private String jwtSecret;

    @Bean
    public SecretKey jwtKey() {
        // 密钥仅来自环境变量/配置中心，禁止硬编码生产密钥
        return Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
    }

    @Bean
    public io.jsonwebtoken.JwtParser jwtParser(SecretKey jwtKey) {
        return Jwts.parser().verifyWith(jwtKey).build();
    }
}
