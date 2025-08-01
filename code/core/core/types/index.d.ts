import type { StackNonStyleProps, StackStyleBase, TamaDefer, TamaguiComponent, TamaguiElement, TamaguiProviderProps, TamaguiTextElement, TextNonStyleProps, TextProps, TextStylePropsBase } from '@tamagui/web';
import { createTamagui as createTamaguiWeb } from '@tamagui/web';
import type { RNTextProps, RNViewProps } from './reactNativeTypes';
export { setOnLayoutStrategy, type LayoutEvent, } from '@tamagui/use-element-layout';
type RNExclusiveViewProps = Omit<RNViewProps, keyof StackNonStyleProps>;
export interface RNTamaguiViewNonStyleProps extends StackNonStyleProps, RNExclusiveViewProps {
}
type RNTamaguiView = TamaguiComponent<TamaDefer, TamaguiElement, RNTamaguiViewNonStyleProps, StackStyleBase, {}>;
type RNExclusiveTextProps = Omit<RNTextProps, keyof TextProps>;
export interface RNTamaguiTextNonStyleProps extends TextNonStyleProps, RNExclusiveTextProps {
}
type RNTamaguiText = TamaguiComponent<TamaDefer, TamaguiTextElement, RNTamaguiTextNonStyleProps, TextStylePropsBase, {}>;
export * from '@tamagui/web';
export * from './reactNativeTypes';
export declare const TamaguiProvider: (props: TamaguiProviderProps) => import("react/jsx-runtime").JSX.Element;
export declare const createTamagui: typeof createTamaguiWeb;
export declare const View: RNTamaguiView;
export declare const Stack: RNTamaguiView;
export declare const Text: RNTamaguiText;
//# sourceMappingURL=index.d.ts.map