"""階級のキャラクター画像を、出す前に数値で確かめる。

見るところ:
  ・見切れ  … 枠のふち3pxに絵が残っていないか
  ・透け    … 顔のあたりが不透明か（体が白いので抜きすぎると透ける）
  ・枠線    … 元画像のカード枠が写り込んでいないか（細い直線が端に残る）
目視では毎回見落とすので、必ずこれを通してから出すこと。
"""
from PIL import Image
import numpy as np, sys

NAMES = ["rookie","challenger","consistent","master","expert","legend"]
allok = True
for n in NAMES:
    a = np.asarray(Image.open(f"assets/rank/{n}.png"))
    al = a[:,:,3]; h, w = al.shape
    edge = max(al[:6,:].max(), al[-6:,:].max(), al[:,:6].max(), al[:,-6:].max())
    # 顔は枠の上半分の真ん中あたり。輪郭で切っているので位置は絵ごとに少し違う。
    face = a[int(h*0.30):int(h*0.42), int(w*0.46):int(w*0.54), 3].min()
    filled = al > 25
    # 枠線＝「細くて（3px以下）」「ほぼ端から端まで伸びる」直線。
    # 杖や体も縦に長いので、太さで見分ける。
    def thin_lines(mask, axis):
        cov = mask.sum(axis=axis)
        length = mask.shape[axis]
        hit = [i for i, c in enumerate(cov) if c > length*0.9]
        runs, cur = [], []
        for i in hit:
            if cur and i == cur[-1]+1: cur.append(i)
            else:
                if cur: runs.append(cur)
                cur = [i]
        if cur: runs.append(cur)
        return [r for r in runs if len(r) <= 3]
    v = thin_lines(filled, 0); hl = thin_lines(filled, 1)
    ok = edge == 0 and face > 250 and not v and not hl
    allok &= ok
    print(f"{n:12} 見切れ{'なし' if edge==0 else 'あり('+str(edge)+')'} / "
          f"顔{'不透明' if face>250 else '透け('+str(face)+')'} / "
          f"枠線{'なし' if not (v or hl) else 'あり'}  {'OK' if ok else '要修正'}")
print("総合:", "OK" if allok else "要修正")
sys.exit(0 if allok else 1)
