"""Generate the commentator's voice clips (same male voice in every browser).

    pip install edge-tts
    python tools/gen_voice.py

Clips are short phrases + numbers that js/app.js chains together. The output
(audio/*.mp3) is committed, so the site itself needs no TTS service at runtime.
"""
import asyncio
import os
import edge_tts

VOICE = 'ar-SA-HamedNeural'          # male, Saudi Arabic
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audio')

ONES = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
        'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
TENS = {20: 'عشرون', 30: 'ثلاثون', 40: 'أربعون', 50: 'خمسون', 60: 'ستون'}


def number(n):
    if n < 20:
        return ONES[n]
    t, o = n // 10 * 10, n % 10
    return TENS[t] if o == 0 else f'{ONES[o]} و{TENS[t]}'


# id -> (text, hype)
CLIPS = {
    'goal_1': ('جوووووووول! جوووووول!', 1),
    'goal_2': ('هدف! هدف! هدف! يا سلام!', 1),
    'goal_3': ('جووووول! يا له من هدف رائع!', 1),
    'goal_4': ('يا إلهي! جوووووول!', 1),
    'goal_for': ('لصالح', 1),
    'score_is': ('النتيجة', 0),
    'vs': ('مقابل', 0),
    'left': ('بقي لديه', 0),
    't1': ('الفريق الأول', 0), 't2': ('الفريق الثاني', 0),
    'p1': ('اللاعب الأول', 0), 'p2': ('اللاعب الثاني', 0),
    'score_fixed': ('تم تعديل النتيجة', 0),
    'foul_on': ('خطأ على', 0),
    'foul_ref': ('صافرة الحكم، خطأ ضد', 0),
    'yellow': ('بطاقة صفراء! إنذار للاعب من', 1),
    'red': ('بطاقة حمراء! طرد مباشر للاعب من', 1),
    'red_after': ('يكمل بنقص عددي', 1),
    'kick_off': ('صافرة البداية! انطلق', 1),
    'resume': ('استؤنف اللعب', 0),
    'paused': ('توقف اللعب', 0),
    'get_ready': ('استعدوا.', 0),
    'period_0': ('الشوط الأول', 0), 'period_1': ('الشوط الثاني', 0),
    'period_2': ('الشوط الإضافي الأول', 0), 'period_3': ('الشوط الإضافي الثاني', 0),
    'regular_end': ('انتهى الوقت الأصلي. الحكم يحتسب وقتًا بدل ضائع', 1),
    'timeout': ('وقت مستقطع،', 0),
    'pen2': ('إيقاف لمدة دقيقتين للاعب في', 0),
    'pen_back': ('انتهى إيقاف اللاعب، ويعود إلى الملعب في', 0),
    'break': ('استراحة بين الشوطين. استعدوا للشوط الثاني', 0),
    'half_end': ('انتهى الشوط الأول. النتيجة', 0),
    'match_end': ('صافرة النهاية! انتهت المباراة. النتيجة', 1),
    'voice_on': ('المعلق يعمل الآن', 0),
    'scores_point': ('يسجل نقطة', 0),
    'deuce': ('تعادل، ديوس', 0),
    'adv': ('أفضلية لـ', 0),
    'game_for': ('الشوط لصالح', 1),
    'games_are': ('الأشواط', 0),
    'tb': ('شوط فاصل.', 0),
    'tb_start': ('ستة أشواط لكل لاعب. نلجأ إلى الشوط الفاصل', 1),
    'set_for': ('المجموعة لصالح', 1),
    'match_over': ('انتهت المباراة! الفائز', 1),
    'congrats': ('مبروك!', 1),
}
for n in range(0, 61):
    CLIPS[f'n{n}'] = (number(n), 0)


async def make(cid, text, hype, sem):
    path = os.path.join(OUT, cid + '.mp3')
    if os.path.exists(path):
        return
    async with sem:
        rate, pitch = ('+18%', '+4Hz') if hype else ('+6%', '+0Hz')
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch, volume='+0%').save(path)
                return
            except Exception as e:  # network hiccup: retry
                if attempt == 3:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))


async def main():
    os.makedirs(OUT, exist_ok=True)
    sem = asyncio.Semaphore(6)
    await asyncio.gather(*(make(k, t, h, sem) for k, (t, h) in CLIPS.items()))
    print(f'{len(CLIPS)} clips in {os.path.normpath(OUT)}')


if __name__ == '__main__':
    asyncio.run(main())
