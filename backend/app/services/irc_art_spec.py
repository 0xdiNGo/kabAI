"""mIRC ASCII art specification for LLM system prompts.

Based on the birdneststream/asciibird ecosystem and IRC art standards.
Injected into agent prompts when generating IRC-compatible art.
"""

IRC_ART_SPEC = """
mIRC ASCII ART SPECIFICATION:

FORMAT:
- \\x03FG,BG sets foreground/background color. FG and BG are 0-98.
- ALWAYS zero-pad single-digit colors: \\x0304 NOT \\x034 (parsing breaks otherwise).
- \\x0F resets ALL formatting. Use at end of every line.
- \\x02 = bold, \\x1F = underline, \\x1D = italic, \\x16 = reverse.
- Bare \\x03 (no digits) resets color only.

COLOR PALETTE (standard 16):
00=White 01=Black 02=Blue 03=Green 04=Red 05=Brown 06=Magenta 07=Orange
08=Yellow 09=LightGreen 10=Cyan 11=LightCyan 12=LightBlue 13=Pink 14=Grey 15=LightGrey

EXTENDED COLORS (16-98): 83 additional colors available for fine gradients.
16-27: dark reds/greens/blues, 28-51: mid saturation, 52-87: vivid neons, 88-98: grayscale.

LINE RULES:
- EXACTLY 80 visible characters per line. NO MORE. NO LESS.
- Control codes (\\x03NN,NN and \\x0F etc) do NOT count as visible.
- Only printable characters count: letters, numbers, symbols, spaces, █▀▄░▒▓, box drawing.
- Maximum 510 bytes per line (IRC protocol limit).
- Pad short lines with spaces to 80. End every line with \\x0F.
- VERIFY: strip all \\x03[digits][,digits] and \\x0F/\\x02/\\x1D/\\x1F/\\x16, then count. Must be 80.
- Common mistake: borders (═║) count as visible chars. A line with ║ + 78 content + ║ = 80.

CHARACTERS:
- Block fills: █ (solid), ▀▄ (half blocks for 2x vertical resolution)
- Shading: ░▒▓ (light/medium/dark)
- Box drawing: ─│┌┐└┘├┤┬┴┼ and double: ═║╔╗╚╝╠╣╦╩╬
- Safe ASCII: all printable ASCII 32-126
- AVOID: emoji, East Asian fullwidth, combining characters

TECHNIQUES:
- Use \\x03FG,BG█ for solid colored blocks (foreground color fills the block).
- Use half-blocks ▀▄ with different FG/BG colors for 2x vertical resolution.
- Layer colors line-by-line for smooth gradients.
- Use \\x0301,01█ for black-on-black (invisible = erased area).
- Reset between color segments: \\x0304,01████\\x0F\\x0308,01████\\x0F

EXAMPLE (3-line sunset):
\\x0308,08████████████████████████████████████████████████████████████████████████████████\\x0F
\\x0307,07████████████████████████████████████████████████████████████████████████████████\\x0F
\\x0304,04████████████████████████████████████████████████████████████████████████████████\\x0F
""".strip()
