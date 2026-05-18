"use client";

import React from "react";
import Link from "next/link";

export default function TestImagesPage() {
  // Test different path variations - mimicking what the game does
  const testPaths = [
    // Test 1: Original path (spaces as-is)
    "/models/Stickfigure Player/idle/stickman fighter-black-1_-idle_00.png",
    // Test 2: Fully URL-encoded (what the game code produces)
    "/models/Stickfigure%20Player/idle/stickman%20fighter-black-1_-idle_00.png",
    // Test 3: Walk normal animation (has space in animName)
    "/models/Stickfigure Player/walk normal/stickman fighter-black-1_-walk normal_00.png",
    // Test 4: Walk normal fully encoded
    "/models/Stickfigure%20Player/walk%20normal/stickman%20fighter-black-1_-walk%20normal_00.png",
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)",
        color: "#ffffff",
        fontFamily: "'Rajdhani', 'Share Tech Mono', ui-monospace",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "40px", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "48px",
              fontWeight: 900,
              letterSpacing: "4px",
              textShadow: "0 0 20px rgba(255,255,255,0.8)",
              marginBottom: "20px",
            }}
          >
            IMAGE PATH TESTING
          </h1>
          <p
            style={{
              fontSize: "18px",
              color: "#999999",
              marginBottom: "30px",
            }}
          >
            Testing different image path formats for Vercel deployment
          </p>
          <Link href="/">
            <button
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                fontFamily: "'Rajdhani', 'Share Tech Mono', ui-monospace",
                fontWeight: 900,
                background: "linear-gradient(135deg, rgba(80,80,80,0.95), rgba(40,40,40,0.97))",
                border: "2px solid rgba(255,255,255,0.8)",
                borderRadius: "10px",
                color: "#ffffff",
                cursor: "pointer",
                textShadow: "0 0 15px rgba(255,255,255,0.8)",
                letterSpacing: "2px",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.05)";
                e.currentTarget.style.boxShadow = "0 0 30px rgba(255,255,255,0.6)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              ← BACK TO GAME
            </button>
          </Link>
        </div>

        {/* Test Cards */}
        <div style={{ display: "grid", gap: "30px" }}>
          {testPaths.map((path, idx) => (
            <div
              key={idx}
              style={{
                background: "rgba(30,30,30,0.9)",
                border: "2px solid rgba(255,255,255,0.5)",
                borderRadius: "12px",
                padding: "24px",
                boxShadow: "0 0 20px rgba(255,255,255,0.2)",
              }}
            >
              <div
                style={{
                  fontSize: "14px",
                  color: "#ffffff",
                  marginBottom: "12px",
                  fontWeight: 700,
                  letterSpacing: "1px",
                }}
              >
                TEST #{idx + 1}
              </div>
              
              <div
                style={{
                  background: "rgba(0,0,0,0.5)",
                  padding: "12px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  wordBreak: "break-all",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  color: "#00ff00",
                }}
              >
                {path}
              </div>

              <div
                style={{
                  background: "rgba(0,0,0,0.3)",
                  padding: "20px",
                  borderRadius: "8px",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  minHeight: "200px",
                  border: "1px dashed rgba(255,255,255,0.3)",
                }}
              >
                <img
                  src={path}
                  alt={`Test image ${idx + 1}`}
                  onLoad={(e) => {
                    console.log(`✅ Image loaded successfully: ${path}`);
                    e.currentTarget.parentElement!.style.borderColor = "rgba(0,255,0,0.6)";
                  }}
                  onError={(e) => {
                    console.error(`❌ Failed to load image: ${path}`);
                    e.currentTarget.parentElement!.style.borderColor = "rgba(255,0,0,0.6)";
                    e.currentTarget.parentElement!.innerHTML = `
                      <div style="color: #ff6666; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <div style="font-size: 16px; font-weight: 700;">FAILED TO LOAD</div>
                      </div>
                    `;
                  }}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "300px",
                    imageRendering: "pixelated",
                    filter: "drop-shadow(0 0 10px rgba(255,255,255,0.5))",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Additional Info */}
        <div
          style={{
            marginTop: "40px",
            background: "rgba(30,30,30,0.9)",
            border: "2px solid rgba(255,255,255,0.5)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <div
            style={{
              fontSize: "18px",
              fontWeight: 900,
              marginBottom: "16px",
              letterSpacing: "2px",
              textShadow: "0 0 15px rgba(255,255,255,0.8)",
            }}
          >
            📋 DEBUGGING INFO
          </div>
          <div style={{ fontSize: "14px", color: "#cccccc", lineHeight: "2" }}>
            <div><strong>Current URL:</strong> {typeof window !== "undefined" ? window.location.href : "Loading..."}</div>
            <div><strong>Public Folder:</strong> /public/models/Stickfigure Player/</div>
            <div><strong>Test Image:</strong> stickman fighter-black-1_-idle_00.png</div>
            <div style={{ marginTop: "16px", color: "#999999", fontSize: "12px" }}>
              Check the browser console for detailed loading information.
              Green border = success, Red border = failure.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

