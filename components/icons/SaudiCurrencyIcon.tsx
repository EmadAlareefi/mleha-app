import Image from 'next/image';

type SaudiCurrencyIconProps = {
  className?: string;
};

export default function SaudiCurrencyIcon({ className }: SaudiCurrencyIconProps) {
  return (
    <Image
      src="/icons/saudi-riyal-symbol.svg"
      alt="Saudi Riyal"
      width={20}
      height={22}
      className={className}
      priority={false}
    />
  );
}
