import { nvidia, NVIDIA_MODEL } from "../src/lib/shopify/nvidia-client";

async function test() {
  const response = await nvidia.chat.completions.create({
    model: NVIDIA_MODEL,
    messages: [
      {
        role: "system",
        content: 'Respond with ONLY valid JSON: { "status": "ok", "value": 42 }',
      },
      { role: "user", content: "test" },
    ],
    response_format: { type: "json_object" },
    max_tokens: 50,
  });
  console.log("Raw response:", response.choices[0].message.content);
  try {
    console.log("Parsed:", JSON.parse(response.choices[0].message.content!));
  } catch {
    console.error("JSON mode NOT working as expected — fallback needed");
  }
}

test().catch((err) => {
  console.error(err);
  process.exit(1);
});
