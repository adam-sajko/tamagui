import React from "react";
import PropTypes from 'prop-types';
import type { IconProps } from '@tamagui/helpers-icon';
import {
  Svg,
  Circle as _Circle,
  Ellipse,
  G,
  LinearGradient,
  RadialGradient,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Symbol,
  Text as _Text,
  Use,
  Defs,
  Stop } from
'react-native-svg';
import { themed } from '@tamagui/helpers-icon';

const Icon = (props) => {
  const { color = 'black', size = 24, ...otherProps } = props;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...otherProps}>

      <Rect width="6" height="14" x="2" y="5" rx="2" stroke={color} />
      <Rect width="6" height="10" x="12" y="7" rx="2" stroke={color} />
      <Path d="M22 2v20" stroke={color} />
    </Svg>);

};

Icon.displayName = 'AlignHorizontalJustifyEnd';

export const AlignHorizontalJustifyEnd = React.memo<IconProps>(themed(Icon));