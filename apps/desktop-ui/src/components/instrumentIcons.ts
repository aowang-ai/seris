import btcIcon from 'cryptocurrency-icons/svg/color/btc.svg';
import ethIcon from 'cryptocurrency-icons/svg/color/eth.svg';
import solIcon from 'cryptocurrency-icons/svg/color/sol.svg';
import avaxIcon from 'cryptocurrency-icons/svg/color/avax.svg';
import dogeIcon from 'cryptocurrency-icons/svg/color/doge.svg';
import uniIcon from 'cryptocurrency-icons/svg/color/uni.svg';
import aaveIcon from 'cryptocurrency-icons/svg/color/aave.svg';
import mkrIcon from 'cryptocurrency-icons/svg/color/mkr.svg';
import crvIcon from 'cryptocurrency-icons/svg/color/crv.svg';
import linkIcon from 'cryptocurrency-icons/svg/color/link.svg';
import dotIcon from 'cryptocurrency-icons/svg/color/dot.svg';
import atomIcon from 'cryptocurrency-icons/svg/color/atom.svg';
import maticIcon from 'cryptocurrency-icons/svg/color/matic.svg';
import bnbIcon from 'cryptocurrency-icons/svg/color/bnb.svg';
import xrpIcon from 'cryptocurrency-icons/svg/color/xrp.svg';
import adaIcon from 'cryptocurrency-icons/svg/color/ada.svg';
import ltcIcon from 'cryptocurrency-icons/svg/color/ltc.svg';
import bchIcon from 'cryptocurrency-icons/svg/color/bch.svg';
import etcIcon from 'cryptocurrency-icons/svg/color/etc.svg';
import filIcon from 'cryptocurrency-icons/svg/color/fil.svg';
import icpIcon from 'cryptocurrency-icons/svg/color/icp.svg';
import sandIcon from 'cryptocurrency-icons/svg/color/sand.svg';
import snxIcon from 'cryptocurrency-icons/svg/color/snx.svg';
import sushiIcon from 'cryptocurrency-icons/svg/color/sushi.svg';
import thetaIcon from 'cryptocurrency-icons/svg/color/theta.svg';
import vetIcon from 'cryptocurrency-icons/svg/color/vet.svg';
import xlmIcon from 'cryptocurrency-icons/svg/color/xlm.svg';
import xmrIcon from 'cryptocurrency-icons/svg/color/xmr.svg';
import xtzIcon from 'cryptocurrency-icons/svg/color/xtz.svg';
import yfiIcon from 'cryptocurrency-icons/svg/color/yfi.svg';
import zecIcon from 'cryptocurrency-icons/svg/color/zec.svg';

const ICONS: Record<string, string> = {
  btc: btcIcon, eth: ethIcon, sol: solIcon, avax: avaxIcon, doge: dogeIcon,
  uni: uniIcon, aave: aaveIcon, mkr: mkrIcon, crv: crvIcon, link: linkIcon,
  dot: dotIcon, atom: atomIcon, matic: maticIcon, bnb: bnbIcon, xrp: xrpIcon,
  ada: adaIcon, ltc: ltcIcon, bch: bchIcon, etc: etcIcon, fil: filIcon,
  icp: icpIcon, sand: sandIcon, snx: snxIcon, sushi: sushiIcon, theta: thetaIcon,
  vet: vetIcon, xlm: xlmIcon, xmr: xmrIcon, xtz: xtzIcon, yfi: yfiIcon,
  zec: zecIcon,
};

export function instrumentIcon(symbol: string): string | null {
  return ICONS[symbol.toLowerCase().replace(/usdt$/i, '').replace(/usd$/i, '')] ?? null;
}
