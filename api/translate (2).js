const SYSTEM_PROMPT = `You are an Empathetic Clinical Translator working inside an urgent care clinic's internal tool. Your sole job is to translate an existing radiology report into language a patient can easily understand.

RULES — follow these exactly:
1. Write at a 6th-grade reading level. Use short sentences. Avoid jargon.
2. Translate ONLY what is in the report. Never add new diagnoses, medical advice, treatment suggestions, or findings that are not explicitly stated.
3. If a finding is described as "unremarkable," "grossly normal," "within normal limits," or similar, translate it as "Normal / Healthy."
4. Be reassuring and professional, but never minimize genuinely abnormal findings.
5. If the report is unclear or unreadable (e.g., a blurry image), say so honestly instead of guessing.

OUTPUT FORMAT — respond with **only** valid JSON, no markdown fences, no commentary:
{
  "summary": "A 2-3 sentence plain-language summary of the key findings. This is the 'bottom line' for the patient.",
  "findings": [
    {
      "term": "Medical Term from the report",
      "translation": "Plain-language explanation of what this means",
      "status": "Normal | Abnormal | Critical"
    }
  ]
}

If the report contains no findings (e.g., a blank image or unrelated document), return:
{
  "summary": "This does not appear to be a radiology report. Please upload or paste a valid radiology report.",
  "findings": []
}`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY environment variable is not set.' });
  }

  var body = req.body || {};
  var type = body.type;
  var text = body.text;
  var fileData = body.fileData;
  var fileMime = body.fileMime;

  if (type === 'text' && (!text || !text.trim())) {
    return res.status(400).json({ error: 'Report text cannot be empty.' });
  }

  if (type === 'file' && (!fileData || !fileMime)) {
    return res.status(400).json({ error: 'File data and MIME type are required.' });
  }

  var allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  if (type === 'file' && allowedMimes.indexOf(fileMime) === -1) {
    return res.status(400).json({ error: 'Unsupported file type. Upload a PDF, JPG, or PNG.' });
  }

  var userContent = [];

  if (type === 'file') {
    if (fileMime === 'application/pdf') {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: fileData }
      });
    } else {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: fileMime, data: fileData }
      });
    }
    userContent.push({
      type: 'text',
      text: 'Please translate this radiology report according to your instructions. Return only the JSON object.'
    });
  } else {
    userContent.push({
      type: 'text',
      text: 'RADIOLOGY REPORT:\n\n' + text
    });
    userContent.push({
      type: 'text',
      text: 'Please translate this radiology report according to your instructions. Return only the JSON object.'
    });
  }

  try {
    var anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    var data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      var errType = data.error ? data.error.type : '';
      var errMsg = data.error ? data.error.message : 'Unknown error';

      if (errType === 'authentication_error') {
        return res.status(401).json({ success: false, error: 'API key invalid. Check ANTHROPIC_API_KEY in Vercel settings.' });
      }
      if (errType === 'rate_limit_error') {
        return res.status(429).json({ success: false, error: 'Rate limit hit. Wait a moment and retry.' });
      }

      console.error('Anthropic error:', errMsg);
      return res.status(500).json({ success: false, error: 'AI error: ' + errMsg });
    }

    var resultText = '';
    for (var i = 0; i < data.content.length; i++) {
      if (data.content[i].type === 'text') {
        resultText += data.content[i].text;
      }
    }

    resultText = resultText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    var parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch (e) {
      parsed = { summary: resultText, findings: [] };
    }

    return res.status(200).json({ success: true, data: parsed });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please try again.' });
  }
};
