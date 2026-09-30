"""Generate the commentator's voice clips (same male voice in every browser).

    pip install edge-tts
    python tools/gen_voice.py

Clips are short phrases + numbers that js/app.js chains together, in Arabic
(audio/ar) and English (audio/en). The output is committed, so the site needs
no TTS service at runtime. Existing files are skipped; delete one to redo it.
"""
import asyncio
import os
import edge_tts

VOICES = {'ar': 'ar-SA-HamedNeural', 'en': 'en-US-GuyNeural'}   # both male
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audio')

ONES_AR = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
           'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
TENS_AR = {20: 'عشرون', 30: 'ثلاثون', 40: 'أربعون', 50: 'خمسون', 60: 'ستون'}
ONES_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
           'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS_EN = {20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty'}


def number_ar(n):
    if n < 20:
        return ONES_AR[n]
    t, o = n // 10 * 10, n % 10
    return TENS_AR[t] if o == 0 else f'{ONES_AR[o]} و{TENS_AR[t]}'


def number_en(n):
    if n < 20:
        return ONES_EN[n]
    t, o = n // 10 * 10, n % 10
    return TENS_EN[t] if o == 0 else f'{TENS_EN[t]} {ONES_EN[o]}'


# id -> (arabic, english, hype)
CLIPS = {
    'goal_1': ('جوووووووول! جوووووول!', 'Goaaaaal! Goal! Goaaaal!', 1),
    'goal_2': ('هدف! هدف! هدف! يا سلام!', 'Goal! Goal! Goal! What a strike!', 1),
    'goal_3': ('جووووول! يا له من هدف رائع!', 'Gooooal! What a fantastic goal!', 1),
    'goal_4': ('يا إلهي! جوووووول!', 'Oh my! Goooooal!', 1),
    'goal_for': ('لصالح', 'for', 1),
    'score_is': ('النتيجة', 'The score is', 0),
    'vs': ('مقابل', 'to', 0),
    'left': ('بقي لديه', 'remaining:', 0),
    't1': ('الفريق الأول', 'Team One', 0), 't2': ('الفريق الثاني', 'Team Two', 0),
    'p1': ('اللاعب الأول', 'Player One', 0), 'p2': ('اللاعب الثاني', 'Player Two', 0),
    'score_fixed': ('تم تعديل النتيجة', 'Score corrected', 0),
    'foul_on': ('خطأ على', 'Foul on', 0),
    'foul_ref': ('صافرة الحكم، خطأ ضد', 'The referee blows, foul against', 0),
    'yellow': ('بطاقة صفراء! إنذار للاعب من', 'Yellow card! A booking for a player from', 1),
    'red': ('بطاقة حمراء! طرد مباشر للاعب من', 'Red card! Sent off, a player from', 1),
    'red_after': ('يكمل بنقص عددي', 'will play a man down', 1),
    'kick_off': ('صافرة البداية! انطلق', "It's kick-off! Underway:", 1),
    'resume': ('استؤنف اللعب', 'Play resumes', 0),
    'paused': ('توقف اللعب', 'Play is stopped', 0),
    'get_ready': ('استعدوا.', 'Get ready.', 0),
    'period_0': ('الشوط الأول', 'first half', 0), 'period_1': ('الشوط الثاني', 'second half', 0),
    'period_2': ('الشوط الإضافي الأول', 'first period of extra time', 0),
    'period_3': ('الشوط الإضافي الثاني', 'second period of extra time', 0),
    'regular_end': ('انتهى الوقت الأصلي. الحكم يحتسب وقتًا بدل ضائع', 'Regular time is up. The referee adds stoppage time', 1),
    'timeout': ('وقت مستقطع،', 'Timeout,', 0),
    'pen2': ('إيقاف لمدة دقيقتين للاعب في', 'Two-minute suspension for a player from', 0),
    'pen_back': ('انتهى إيقاف اللاعب، ويعود إلى الملعب في', 'Suspension over, the player returns for', 0),
    'break': ('استراحة بين الشوطين. استعدوا للشوط الثاني', 'Half-time break. Get ready for the second half', 0),
    'half_end': ('انتهى الشوط الأول. النتيجة', 'End of the first half. The score is', 0),
    'match_end': ('صافرة النهاية! انتهت المباراة. النتيجة', "That's the final whistle! Full time. The score is", 1),
    'voice_on': ('المعلق يعمل الآن', 'The commentator is on', 0),
    'scores_point': ('يسجل نقطة', 'wins the point', 0),
    'deuce': ('تعادل، ديوس', 'Deuce', 0),
    'adv': ('أفضلية لـ', 'Advantage', 0),
    'game_for': ('الشوط لصالح', 'Game to', 1),
    'games_are': ('الأشواط', 'Games', 0),
    'tb': ('شوط فاصل.', 'Tie-break.', 0),
    'tb_start': ('ستة أشواط لكل لاعب. نلجأ إلى الشوط الفاصل', 'Six games all. We go to a tie-break', 1),
    'set_for': ('المجموعة لصالح', 'Set to', 1),
    'match_over': ('انتهت المباراة! الفائز', 'Game, set and match! The winner is', 1),
    'congrats': ('مبروك!', 'Congratulations!', 1),
}
for n in range(0, 61):
    CLIPS[f'n{n}'] = (number_ar(n), number_en(n), 0)


async def make(lang, cid, text, hype, sem):
    path = os.path.join(ROOT, lang, cid + '.mp3')
    if os.path.exists(path):
        return
    async with sem:
        rate, pitch = ('+18%', '+4Hz') if hype else ('+6%', '+0Hz')
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICES[lang], rate=rate, pitch=pitch, volume='+0%').save(path)
                return
            except Exception:  # network hiccup: retry
                if attempt == 3:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))


async def main():
    sem = asyncio.Semaphore(6)
    jobs = []
    for lang in VOICES:
        os.makedirs(os.path.join(ROOT, lang), exist_ok=True)
        for cid, (ar, en, hype) in CLIPS.items():
            jobs.append(make(lang, cid, ar if lang == 'ar' else en, hype, sem))
    await asyncio.gather(*jobs)
    print(f'{len(CLIPS)} clips x {len(VOICES)} languages in {os.path.normpath(ROOT)}')


if __name__ == '__main__':
    asyncio.run(main())
