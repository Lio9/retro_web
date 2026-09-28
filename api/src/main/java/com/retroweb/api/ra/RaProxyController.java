package com.retroweb.api.ra;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.Map;

/**
 * RetroAchievements Connect 代理（dorequest.php）
 *
 * 前端通过本服务调用 RA，好处：
 *  1) 绕过浏览器 CORS
 *  2) API Key / Token 不直接暴露在前端持久化（仍可能经 HTTPS 传递，注意生产用会话）
 *  3) 可做限流与审计
 *
 * 协议与 rcheevos 对齐：
 *  r=login2 | gameid | patch | unlocks | startsession | awardachievement | ping
 */
@RestController
@RequestMapping("/api/ra")
public class RaProxyController {

    private final RestClient raClient;
    private final String apiKey;

    public RaProxyController(
            @Value("${app.ra.api-base:https://retroachievements.org}") String apiBase,
            @Value("${app.ra.api-key:}") String apiKey) {
        this.apiKey = apiKey;
        this.raClient = RestClient.builder()
                .baseUrl(apiBase.replaceAll("/$", ""))
                .build();
    }

    /**
     * 通用 dorequest 透传。
     * 请求体：{ "r": "login2", "u": "...", "p": "..." } 等，与 RA 字段一致。
     */
    @PostMapping("/dorequest")
    public ResponseEntity<String> dorequest(@RequestBody Map<String, Object> body) {
        // 只放行 RA Connect 使用的指令，避免变成开放代理
        String r = String.valueOf(body.getOrDefault("r", ""));
        if (!allowedCommands.contains(r)) {
            return ResponseEntity.badRequest().body("{\"Error\":\"unsupported r\"}");
        }

        var form = new org.springframework.util.LinkedMultiValueMap<String, String>();
        for (Map.Entry<String, Object> e : body.entrySet()) {
            if (e.getValue() != null) {
                form.add(e.getKey(), String.valueOf(e.getValue()));
            }
        }

        try {
            String resp = raClient.post()
                    .uri("/dorequest.php")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            return ResponseEntity.ok(resp == null ? "{}" : resp);
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body("{\"Error\":\"ra-proxy-failed\",\"Message\":\"" +
                            ex.getMessage().replace("\"", "'") + "\"}");
        }
    }

    /** 健康检查：配置是否含 API Key（不打印密钥） */
    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> m = new HashMap<>();
        m.put("proxy", "ready");
        m.put("hasApiKey", apiKey != null && !apiKey.isBlank());
        return m;
    }

    private static final java.util.Set<String> allowedCommands = java.util.Set.of(
            "login", "login2", "gameid", "patch", "unlocks",
            "startsession", "ping", "awardachievement", "submitlbentry",
            "achievementsets", "allprogress"
    );
}
